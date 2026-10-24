import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateWebhook,
  MAX_WEBHOOKS,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
  type WebhookCreated,
} from "@shortloop/contracts";
import { and, desc, eq, isNull, schema } from "@shortloop/db";
import { webhookAad } from "@shortloop/pipeline";
import { newWebhookSecret } from "@shortloop/providers";
import type { z } from "zod";
import { UserError } from "../errors";
import { runtime } from "../runtime";

/** Webhook endpoints for the public API (E12-01). Delivery itself runs in `@shortloop/pipeline` (`dispatchWebhooks`). */

const iso = (s: string | null) => (s ? new Date(s).toISOString() : undefined);
type Row = typeof schema.webhooks.$inferSelect;
const toWebhook = (r: Row): Webhook =>
  Webhook.parse({
    id: r.id,
    url: r.url,
    events: r.events.filter((e) => WebhookEventType.safeParse(e).success),
    created_at: iso(r.createdAt),
  });

export async function listWebhooks(userId: string): Promise<Webhook[]> {
  const { db } = await runtime();
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.ownerId, userId), isNull(schema.webhooks.disabledAt)))
    .orderBy(desc(schema.webhooks.createdAt));
  return rows.map(toWebhook);
}

export async function createWebhook(userId: string, input: unknown): Promise<z.infer<typeof WebhookCreated>> {
  const data = CreateWebhook.parse(input);
  const rt = await runtime();
  if ((await listWebhooks(userId)).length >= MAX_WEBHOOKS)
    throw new UserError(`You can register up to ${MAX_WEBHOOKS} webhooks. Remove one first.`);
  const id = `wh_${randomUUID()}`;
  const secret = newWebhookSecret();
  const [row] = await rt.db
    .insert(schema.webhooks)
    .values({
      id,
      ownerId: userId,
      url: data.url,
      events: [...new Set(data.events)],
      secret: rt.box.seal(secret, webhookAad(userId, id)),
    })
    .returning();
  if (!row) throw new Error("webhook insert returned nothing");
  await rt.db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "webhook.created",
    subjectId: id,
    data: { url: data.url, events: row.events },
  });
  return { ...toWebhook(row), secret };
}

async function ownWebhook(userId: string, webhookId: string): Promise<Row> {
  const { db } = await runtime();
  const row = await db.query.webhooks.findFirst({
    where: and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.ownerId, userId)),
  });
  if (!row || row.disabledAt) throw new UserError("Webhook not found.");
  return row;
}

/** Soft-delete (deliveries keep their history); pending deliveries are then marked failed by the dispatcher. */
export async function deleteWebhook(userId: string, webhookId: string): Promise<void> {
  const row = await ownWebhook(userId, webhookId);
  const { db } = await runtime();
  await db
    .update(schema.webhooks)
    .set({ disabledAt: new Date().toISOString() })
    .where(eq(schema.webhooks.id, row.id));
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "webhook.deleted",
    subjectId: row.id,
    data: { url: row.url },
  });
}

export async function listDeliveries(userId: string, webhookId: string): Promise<WebhookDelivery[]> {
  const row = await ownWebhook(userId, webhookId);
  const { db } = await runtime();
  const rows = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.webhookId, row.id))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(50);
  return rows.map((d) =>
    WebhookDelivery.parse({
      id: d.id,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      response_status: d.responseStatus ?? undefined,
      error: d.error ?? undefined,
      created_at: iso(d.createdAt),
      delivered_at: iso(d.deliveredAt),
      next_attempt_at: d.status === "pending" ? iso(d.nextAttemptAt) : undefined,
    }),
  );
}

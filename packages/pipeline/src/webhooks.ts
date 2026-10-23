import { createHash, randomUUID } from "node:crypto";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  WebhookPayload,
  type WebhookEventData,
  type WebhookEventType,
} from "@shortloop/contracts";
import { and, asc, eq, gte, inArray, isNull, lte, schema, type Db } from "@shortloop/db";
import { SIGNATURE_HEADER, signWebhook, type SecretBox, type WebhookSender } from "@shortloop/providers";
import type { JobUpdated } from "./jobs";

/**
 * Webhook delivery for the public API (E12-01).
 *
 * Events are found by scanning rows that are final once written (finished jobs, settled publish records), so a
 * missed pub/sub message or a restart never loses one. Each (webhook, event) pair is inserted once thanks to a
 * unique key, which also makes it safe for several web instances to run the dispatcher at the same time.
 */

/** Only events from the last day are picked up (and never ones from before the webhook existed). */
export const WEBHOOK_LOOKBACK_MS = 24 * 60 * 60_000;
/** A claimed delivery is retried after this if the process dies mid-send. */
const CLAIM_MS = 2 * 60_000;

const PRODUCTION_STAGES = ["script", "voice", "visuals", "render"] as const;

export const webhookAad = (ownerId: string, webhookId: string) => `webhook:${ownerId}:${webhookId}`;

interface FoundEvent {
  type: WebhookEventType;
  key: string;
  at: string;
  data: WebhookEventData;
}

const iso = (s: string) => new Date(s).toISOString();

function projectIdOf(input: Record<string, unknown>): string | undefined {
  const chain = input.chain as { projectId?: unknown } | undefined;
  const id = chain?.projectId ?? input.projectId;
  return typeof id === "string" ? id : undefined;
}

async function eventsFor(db: Db, ownerId: string, since: string): Promise<FoundEvent[]> {
  const found: FoundEvent[] = [];
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.ownerId, ownerId),
        gte(schema.jobs.updatedAt, since),
        inArray(schema.jobs.status, ["succeeded", "failed"]),
        inArray(schema.jobs.type, [...PRODUCTION_STAGES]),
      ),
    );
  for (const j of jobs) {
    const project_id = projectIdOf(j.input);
    if (j.status === "succeeded" && j.type === "render") {
      found.push({
        type: "job.succeeded",
        key: `job.succeeded:${j.id}`,
        at: iso(j.updatedAt),
        data: { job_id: j.id, kind: "production", project_id, status: "ready" },
      });
    } else if (j.status === "failed") {
      found.push({
        type: "job.failed",
        key: `job.failed:${j.id}`,
        at: iso(j.updatedAt),
        data: { job_id: j.id, kind: "production", project_id, status: "failed", error: j.error ?? undefined },
      });
    }
  }
  const publishes = await db
    .select()
    .from(schema.publishRecords)
    .where(
      and(
        eq(schema.publishRecords.ownerId, ownerId),
        gte(schema.publishRecords.updatedAt, since),
        inArray(schema.publishRecords.status, ["published", "scheduled", "failed"]),
      ),
    );
  for (const p of publishes) {
    const data: WebhookEventData = {
      job_id: p.jobId ?? "",
      kind: "publish",
      project_id: p.projectId ?? undefined,
      status: p.status,
      publish_id: p.id,
      platform: p.platform,
      url: p.url ?? undefined,
      error: p.error ?? undefined,
    };
    if (p.status === "failed") {
      found.push({ type: "job.failed", key: `job.failed:${p.id}`, at: iso(p.updatedAt), data });
    } else {
      found.push({ type: "publish.completed", key: `publish.completed:${p.id}`, at: iso(p.updatedAt), data });
    }
  }
  return found;
}

/** Queue a delivery for every new event each active webhook subscribes to. Returns how many were queued. */
export async function collectWebhookEvents(db: Db, now = new Date()): Promise<number> {
  const hooks = await db.select().from(schema.webhooks).where(isNull(schema.webhooks.disabledAt));
  let queued = 0;
  const floor = now.getTime() - WEBHOOK_LOOKBACK_MS;
  const byOwner = new Map<string, Map<string, FoundEvent[]>>();
  for (const hook of hooks) {
    const since = new Date(Math.max(new Date(hook.createdAt).getTime(), floor)).toISOString();
    // Owners with several webhooks share one scan per distinct `since`.
    const cache = byOwner.get(hook.ownerId) ?? new Map<string, FoundEvent[]>();
    byOwner.set(hook.ownerId, cache);
    const events = cache.get(since) ?? (await eventsFor(db, hook.ownerId, since));
    cache.set(since, events);
    const wanted = events.filter((e) => hook.events.includes(e.type));
    if (wanted.length === 0) continue;
    const rows = wanted.map((e) => {
      const payload = WebhookPayload.parse({
        // Stable per event (not per webhook or attempt) so receivers can dedupe.
        id: `evt_${createHash("sha256").update(`${hook.ownerId}:${e.key}`).digest("hex").slice(0, 24)}`,
        type: e.type,
        created_at: e.at,
        data: e.data,
      });
      return {
        id: `whd_${randomUUID()}`,
        webhookId: hook.id,
        ownerId: hook.ownerId,
        event: e.type,
        eventKey: e.key,
        payload,
        nextAttemptAt: now.toISOString(),
      };
    });
    const inserted = await db
      .insert(schema.webhookDeliveries)
      .values(rows)
      .onConflictDoNothing({
        target: [schema.webhookDeliveries.webhookId, schema.webhookDeliveries.eventKey],
      })
      .returning();
    queued += inserted.length;
  }
  return queued;
}

export interface WebhookDeps {
  db: Db;
  sender: WebhookSender;
  box: SecretBox;
  now?: () => Date;
}

export interface DeliveryRound {
  delivered: number;
  retrying: number;
  failed: number;
}

/** Send every due delivery once: 2xx is delivered; anything else retries with backoff, then fails for good. */
export async function deliverDueWebhooks(deps: WebhookDeps, limit = 50): Promise<DeliveryRound> {
  const { db, sender, box } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const round: DeliveryRound = { delivered: 0, retrying: 0, failed: 0 };
  const due = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.status, "pending"),
        lte(schema.webhookDeliveries.nextAttemptAt, now.toISOString()),
      ),
    )
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(limit);
  for (const d of due) {
    // Claim it, so another instance running the same round skips it.
    const [claimed] = await db
      .update(schema.webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MS).toISOString() })
      .where(
        and(
          eq(schema.webhookDeliveries.id, d.id),
          eq(schema.webhookDeliveries.status, "pending"),
          eq(schema.webhookDeliveries.nextAttemptAt, d.nextAttemptAt),
        ),
      )
      .returning();
    if (!claimed) continue;
    const hook = await db.query.webhooks.findFirst({ where: eq(schema.webhooks.id, d.webhookId) });
    const attempts = d.attempts + 1;
    if (!hook || hook.disabledAt) {
      await db
        .update(schema.webhookDeliveries)
        .set({ status: "failed", attempts, error: "The webhook was removed." })
        .where(eq(schema.webhookDeliveries.id, d.id));
      round.failed++;
      continue;
    }
    const body = JSON.stringify(d.payload);
    let res: { status?: number; error?: string };
    try {
      const secret = box.open(hook.secret, webhookAad(hook.ownerId, hook.id));
      res = await sender.send({
        url: hook.url,
        body,
        headers: {
          "content-type": "application/json",
          "user-agent": "ShortLoop-Webhooks/1.0",
          "shortloop-event": d.event,
          "shortloop-delivery": d.id,
          [SIGNATURE_HEADER]: signWebhook(secret, body, Math.floor(now.getTime() / 1000)),
        },
      });
    } catch (e) {
      res = { error: e instanceof Error ? e.message : String(e) };
    }
    const ok = res.status !== undefined && res.status >= 200 && res.status < 300;
    const error = ok ? null : (res.error ?? `Receiver answered ${res.status}`);
    if (ok) {
      await db
        .update(schema.webhookDeliveries)
        .set({
          status: "delivered",
          attempts,
          responseStatus: res.status,
          error: null,
          deliveredAt: now.toISOString(),
        })
        .where(eq(schema.webhookDeliveries.id, d.id));
      round.delivered++;
    } else if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await db
        .update(schema.webhookDeliveries)
        .set({ status: "failed", attempts, responseStatus: res.status ?? null, error })
        .where(eq(schema.webhookDeliveries.id, d.id));
      round.failed++;
    } else {
      const wait = WEBHOOK_RETRY_DELAYS_MS[attempts - 1] ?? WEBHOOK_RETRY_DELAYS_MS.at(-1) ?? 60_000;
      await db
        .update(schema.webhookDeliveries)
        .set({
          attempts,
          responseStatus: res.status ?? null,
          error,
          nextAttemptAt: new Date(now.getTime() + wait).toISOString(),
        })
        .where(eq(schema.webhookDeliveries.id, d.id));
      round.retrying++;
    }
  }
  return round;
}

/** One full round: find new events, then send what's due. */
export async function dispatchWebhooks(deps: WebhookDeps): Promise<DeliveryRound & { queued: number }> {
  const queued = await collectWebhookEvents(deps.db, (deps.now ?? (() => new Date()))());
  return { queued, ...(await deliverDueWebhooks(deps)) };
}

/**
 * Run rounds every `intervalMs`, and shortly after any job finishes (so receivers hear within a second or two
 * instead of waiting for the next tick). Rounds never overlap. Returns a stop function.
 */
export function startWebhookDispatcher(
  deps: WebhookDeps,
  opts: {
    intervalMs?: number;
    subscribe?: (listener: (e: JobUpdated) => void) => () => void;
    onError?: (e: unknown) => void;
  } = {},
): () => void {
  let running = false;
  let again = false;
  let kick: ReturnType<typeof setTimeout> | undefined;
  const onError = opts.onError ?? ((e: unknown) => console.error("[webhooks]", e));
  const round = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await dispatchWebhooks(deps);
      } while (again);
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void round(), opts.intervalMs ?? 15_000);
  timer.unref?.();
  const unsubscribe = opts.subscribe?.((e) => {
    if (e.status !== "succeeded" && e.status !== "failed") return;
    if (kick) return;
    kick = setTimeout(() => {
      kick = undefined;
      void round();
    }, 500);
    kick.unref?.();
  });
  return () => {
    clearInterval(timer);
    if (kick) clearTimeout(kick);
    unsubscribe?.();
  };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { PublishRequest, publishIdempotencyKey } from "@shortloop/contracts";
import { and, desc, eq, schema } from "@shortloop/db";
import { recordAudit, withSpan } from "@shortloop/pipeline";
import { z } from "zod";
import { assertChannelPublishable } from "./channels";
import { UserError } from "./errors";
import { runtime } from "./runtime";

export const PublishForm = z.object({
  channelId: z.string().min(1),
  title: z.string().trim().min(1, "Add a title").max(100, "Titles can be at most 100 characters"),
  description: z.string().max(4500),
  tags: z.array(z.string().trim().min(1).max(60)).max(30),
  privacy: z.enum(["public", "unlisted", "private"]),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  aiDisclosure: z.boolean(),
});

/** Queue an upload of the approved render to one channel. Publishing the same render twice to a channel is refused. */
export async function publishShort(
  userId: string,
  projectId: string,
  input: z.input<typeof PublishForm>,
  aiRequired: boolean,
): Promise<string> {
  // One trace from this request through the queue to the worker's upload (E13-02).
  return withSpan(
    "publish.request",
    { "shortloop.project_id": projectId, "shortloop.user_id": userId },
    async (span) => {
      const id = await requestPublish(userId, projectId, input, aiRequired);
      span.setAttribute("shortloop.publish_id", id);
      return id;
    },
  );
}

async function requestPublish(
  userId: string,
  projectId: string,
  input: z.input<typeof PublishForm>,
  aiRequired: boolean,
) {
  const form = PublishForm.parse(input);
  const rt = await runtime();
  if (!rt.youtube) throw new UserError("YouTube publishing isn't set up on this server yet.");
  const p = await rt.db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)),
  });
  if (!p) throw new UserError("Project not found");
  if (p.status !== "approved" || !p.renderAssetId)
    throw new UserError("Approve the Short before publishing.");
  const ch = await rt.db.query.channels.findFirst({
    where: and(eq(schema.channels.id, form.channelId), eq(schema.channels.ownerId, userId)),
  });
  if (!ch || ch.status === "disconnected" || ch.platform !== "youtube")
    throw new UserError("Pick one of your connected YouTube channels.");
  if (ch.status === "needs_reconnect")
    throw new UserError("YouTube access for this channel expired. Reconnect it in Channels first.");
  await assertChannelPublishable(userId, ch.id);
  if (form.scheduledAt && new Date(form.scheduledAt).getTime() < Date.now() + 15 * 60_000) {
    throw new UserError("Schedule at least 15 minutes ahead, or publish now.");
  }
  const request = PublishRequest.parse({
    platform: "youtube",
    accountId: ch.id,
    videoAssetId: p.renderAssetId,
    title: form.title,
    description: form.description,
    tags: form.tags,
    privacy: form.privacy,
    scheduledAt: form.scheduledAt,
    aiDisclosure: form.aiDisclosure || aiRequired, // a required label can't be switched off
  });
  const key = publishIdempotencyKey(p.renderAssetId, ch.id);
  const existing = await rt.db.query.publishRecords.findFirst({
    where: eq(schema.publishRecords.idempotencyKey, key),
  });
  if (existing && existing.status !== "failed") {
    throw new UserError(
      existing.url
        ? "This Short is already on that channel."
        : "This Short is already being published to that channel.",
    );
  }
  const id = existing?.id ?? `pub_${randomUUID()}`;
  if (existing) {
    await rt.db
      .update(schema.publishRecords)
      .set({ request, status: "queued", error: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.publishRecords.id, id));
  } else {
    await rt.db.insert(schema.publishRecords).values({
      id,
      ownerId: userId,
      platform: "youtube",
      channelId: ch.id,
      videoAssetId: p.renderAssetId,
      projectId,
      request,
      idempotencyKey: key,
    });
  }
  // A retry after a failure gets a new job; the record (and any saved upload session) is reused, so no double upload.
  const job = await rt.jobs.enqueue(
    "publish",
    { publishId: id, projectId, request },
    { idempotencyKey: existing ? `${key}:retry:${Date.now()}` : key, ownerId: userId },
  );
  await rt.db.update(schema.publishRecords).set({ jobId: job.id }).where(eq(schema.publishRecords.id, id));
  await recordAudit(rt.db, {
    ownerId: userId,
    type: "publish.requested",
    subjectId: id,
    jobId: job.id,
    data: {
      channelId: ch.id,
      projectId,
      scheduledAt: form.scheduledAt ?? null,
      aiDisclosure: request.aiDisclosure,
    },
  });
  return id;
}

export async function listPublishes(userId: string, projectId: string) {
  const { db } = await runtime();
  const rows = await db
    .select({ r: schema.publishRecords, channelTitle: schema.channels.title })
    .from(schema.publishRecords)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.publishRecords.channelId))
    .where(and(eq(schema.publishRecords.ownerId, userId), eq(schema.publishRecords.projectId, projectId)))
    .orderBy(desc(schema.publishRecords.createdAt));
  return rows.map(({ r, channelTitle }) => ({
    id: r.id,
    channelId: r.channelId,
    channelTitle,
    status: r.status,
    url: r.url,
    error: r.error,
    retryAt: r.retryAt,
    scheduledAt: r.request.scheduledAt,
    publishedAt: r.publishedAt,
  }));
}
export type PublishView = Awaited<ReturnType<typeof listPublishes>>[number];

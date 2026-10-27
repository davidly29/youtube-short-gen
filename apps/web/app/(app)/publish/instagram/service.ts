import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { PublishRequest, publishIdempotencyKey } from "@shortloop/contracts";
import { and, desc, eq, schema } from "@shortloop/db";
import { checkVariation, listOverrides, recordAudit, withSpan } from "@shortloop/pipeline";
import { InstagramReconnectRequired, ProfessionalAccountRequired } from "@shortloop/providers";
import { ChannelError, connectInstagramAccount, INSTAGRAM_CAPTION_MAX } from "@shortloop/worker";
import { z } from "zod";
import { UserError } from "../../../../src/server/errors";
import { projectView } from "../../../../src/server/projects";
import { runtime } from "../../../../src/server/runtime";

/** httpOnly cookie holding the OAuth state between /publish/instagram/connect and /callback. */
export const INSTAGRAM_STATE_COOKIE = "ig_oauth_state";
export const INSTAGRAM_COOKIE_PATH = "/publish/instagram";

export async function instagramConfigured() {
  return Boolean((await runtime()).instagram);
}

async function requireClient() {
  const rt = await runtime();
  if (!rt.instagram) throw new UserError("Instagram posting isn't set up on this server yet.");
  return { rt, ig: rt.instagram };
}

export async function startInstagramConnect(): Promise<{ url: string; state: string }> {
  const { ig } = await requireClient();
  const state = randomBytes(24).toString("base64url");
  return { url: ig.authUrl(state), state };
}

/** OAuth callback. Personal accounts get the "switch to Professional" message and nothing is stored. */
export async function finishInstagramConnect(userId: string, code: string): Promise<string> {
  const { rt, ig } = await requireClient();
  try {
    return await connectInstagramAccount(rt.db, rt.box, ig, userId, code);
  } catch (e) {
    if (e instanceof ProfessionalAccountRequired || e instanceof ChannelError) throw new UserError(e.message);
    throw e;
  }
}

type ChannelRow = typeof schema.channels.$inferSelect;

async function instagramChannel(userId: string): Promise<ChannelRow | undefined> {
  const { db } = await runtime();
  const ch = await db.query.channels.findFirst({
    where: and(eq(schema.channels.ownerId, userId), eq(schema.channels.platform, "instagram")),
    orderBy: desc(schema.channels.updatedAt),
  });
  return ch && ch.status !== "disconnected" ? ch : undefined;
}

export const InstagramForm = z.object({
  caption: z
    .string()
    .max(INSTAGRAM_CAPTION_MAX, `Instagram captions can be at most ${INSTAGRAM_CAPTION_MAX} characters`),
});

export interface InstagramPublishView {
  id: string;
  status: string;
  url: string | null;
  error: string | null;
  retryAt: string | null;
  createdAt: string;
}

async function instagramPublishes(userId: string, projectId: string): Promise<InstagramPublishView[]> {
  const { db } = await runtime();
  const rows = await db
    .select()
    .from(schema.publishRecords)
    .where(
      and(
        eq(schema.publishRecords.ownerId, userId),
        eq(schema.publishRecords.projectId, projectId),
        eq(schema.publishRecords.platform, "instagram"),
      ),
    )
    .orderBy(desc(schema.publishRecords.createdAt));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    url: r.url,
    error: r.error,
    retryAt: r.retryAt,
    createdAt: r.createdAt,
  }));
}

/** Everything the Instagram post page needs. */
export async function instagramPostPage(userId: string, projectId: string) {
  const rt = await runtime();
  const view = await projectView(userId, projectId);
  const render = view.project.renderAssetId
    ? await rt.db.query.assets.findFirst({ where: eq(schema.assets.id, view.project.renderAssetId) })
    : undefined;
  const ch = await instagramChannel(userId);
  return {
    configured: Boolean(rt.instagram),
    project: { id: view.project.id, title: view.project.title, status: view.project.status },
    approved: view.project.status === "approved" && Boolean(render),
    publishable: view.publishable,
    videoUrl: view.videoUrl,
    thumbUrl: view.thumbUrl,
    defaultCaption: view.project.title,
    channel: ch ? { id: ch.id, title: ch.title, avatarUrl: ch.avatarUrl, status: ch.status } : undefined,
    publishes: await instagramPublishes(userId, projectId),
  };
}
export type InstagramPostPage = Awaited<ReturnType<typeof instagramPostPage>>;

/**
 * Queue the approved render as a Reel. The job (E8-04b) re-runs every check and polls Instagram's processing, so
 * this only validates and enqueues. Posting the same render to the same account twice is refused.
 */
export async function postToInstagram(
  userId: string,
  projectId: string,
  input: z.input<typeof InstagramForm>,
): Promise<string> {
  return withSpan(
    "publish.request",
    { "shortloop.project_id": projectId, "shortloop.user_id": userId, "shortloop.platform": "instagram" },
    async (span) => {
      const id = await requestReel(userId, projectId, input);
      span.setAttribute("shortloop.publish_id", id);
      return id;
    },
  );
}

async function requestReel(userId: string, projectId: string, input: z.input<typeof InstagramForm>) {
  const form = InstagramForm.parse(input);
  const { rt } = await requireClient();
  const view = await projectView(userId, projectId);
  const p = view.project;
  if (p.status !== "approved" || !p.renderAssetId) throw new UserError("Approve the Short before posting.");
  if (!view.publishable.ok) throw new UserError(view.publishable.problems.join(" "));
  // Same early answer as the job will give, so the user hears about a near-duplicate now, not later.
  const script = p.scriptId
    ? await rt.db.query.scripts.findFirst({ where: eq(schema.scripts.id, p.scriptId) })
    : undefined;
  if (script) {
    const v = await checkVariation(rt.db, userId, script);
    const overridden = (await listOverrides(rt.db, userId)).some((o) => o.subjectId === script.id);
    if (!v.ok && !overridden) throw new UserError(v.reasons.join(" "));
  }
  const ch = await instagramChannel(userId);
  if (!ch) throw new UserError("Connect your Instagram account first.");
  if (ch.status === "needs_reconnect") throw new UserError(new InstagramReconnectRequired().message);

  const request = PublishRequest.parse({
    platform: "instagram",
    accountId: ch.id,
    videoAssetId: p.renderAssetId,
    title: p.title.slice(0, 100) || "Short",
    description: form.caption,
    tags: [],
    privacy: "public",
    aiDisclosure: view.aiDisclosureRequired,
  });
  const key = publishIdempotencyKey(p.renderAssetId, ch.id);
  const existing = await rt.db.query.publishRecords.findFirst({
    where: eq(schema.publishRecords.idempotencyKey, key),
  });
  if (existing && existing.status !== "failed")
    throw new UserError(
      existing.status === "published"
        ? "This Short is already on that Instagram account."
        : "This Short is already being posted to that Instagram account.",
    );
  const id = existing?.id ?? `pub_${randomUUID()}`;
  if (existing)
    await rt.db
      .update(schema.publishRecords)
      .set({ request, status: "queued", error: null, retryAt: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.publishRecords.id, id));
  else
    await rt.db.insert(schema.publishRecords).values({
      id,
      ownerId: userId,
      platform: "instagram",
      channelId: ch.id,
      videoAssetId: p.renderAssetId,
      projectId,
      request,
      idempotencyKey: key,
    });
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
    data: { platform: "instagram", channelId: ch.id, projectId, aiDisclosure: request.aiDisclosure },
  });
  return id;
}

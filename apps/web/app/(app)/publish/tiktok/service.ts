import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { PublishRequest, publishIdempotencyKey } from "@shortloop/contracts";
import { and, desc, eq, schema } from "@shortloop/db";
import { checkVariation, listOverrides, recordAudit } from "@shortloop/pipeline";
import {
  FakeTikTok,
  tiktokAudited,
  tiktokFromEnv,
  tiktokPostProblems,
  tiktokVideoUrl,
  TikTokCannotPost,
  TikTokRateLimited,
  TikTokReconnectRequired,
  toDirectPost,
  TIKTOK_PRIVACY,
  TIKTOK_TITLE_MAX,
  type CreatorInfo,
  type TikTokClient,
  type TikTokPostForm,
} from "@shortloop/providers";
import { channelAad } from "@shortloop/worker";
import { z } from "zod";
import { appOrigin } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import { projectView } from "../../../../src/server/projects";
import { runtime, type Runtime } from "../../../../src/server/runtime";

/** httpOnly cookie holding the OAuth state between /publish/tiktok/connect and /callback. */
export const TIKTOK_STATE_COOKIE = "tt_oauth_state";
export const TIKTOK_COOKIE_PATH = "/publish/tiktok";

const g = globalThis as unknown as { __shortloopTikTok?: TikTokClient | null };

/** TikTok client: the fake in SHORTLOOP_FAKE_PROVIDERS mode, else TIKTOK_CLIENT_KEY/SECRET, else undefined (off). */
export function tiktokClient(rt: Pick<Runtime, "fake">): TikTokClient | undefined {
  if (g.__shortloopTikTok === undefined)
    g.__shortloopTikTok = rt.fake ? new FakeTikTok() : (tiktokFromEnv() ?? null);
  return g.__shortloopTikTok ?? undefined;
}

export async function tiktokConfigured() {
  return Boolean(tiktokClient(await runtime()));
}

/** Until TikTok approves the Content Posting audit (H-01) every post is private. Fake mode follows the env too. */
export const isAudited = () => tiktokAudited();

async function requireClient() {
  const rt = await runtime();
  const tt = tiktokClient(rt);
  if (!tt) throw new UserError("TikTok posting isn't set up on this server yet.");
  return { rt, tt };
}

export async function startTikTokConnect(): Promise<{ url: string; state: string }> {
  const { tt } = await requireClient();
  const state = randomBytes(24).toString("base64url");
  return { url: tt.authUrl(state), state };
}

/** OAuth callback: store the refresh token encrypted; reconnecting the same account replaces it. */
export async function finishTikTokConnect(userId: string, code: string): Promise<string> {
  const { rt, tt } = await requireClient();
  const grant = await tt.exchangeCode(code);
  const creator = await tt.creatorInfo(grant.accessToken).catch(() => undefined);
  const user = creator ? undefined : await tt.userInfo(grant.accessToken);
  const title = creator?.nickname ?? user?.displayName ?? "TikTok account";
  const avatarUrl = creator?.avatarUrl ?? user?.avatarUrl ?? null;
  const existing = await rt.db.query.channels.findFirst({
    where: and(eq(schema.channels.platform, "tiktok"), eq(schema.channels.externalId, grant.openId)),
  });
  if (existing && existing.ownerId !== userId) {
    await tt.revoke(grant.accessToken);
    throw new UserError("That TikTok account is already connected to another ShortLoop account.");
  }
  const id = existing?.id ?? `ch_${randomUUID()}`;
  const values = {
    title,
    avatarUrl,
    secret: rt.box.seal(grant.refreshToken, channelAad(userId, id)),
    scopes: grant.scopes.join(" "),
    status: "connected" as const,
    updatedAt: new Date().toISOString(),
  };
  if (existing) await rt.db.update(schema.channels).set(values).where(eq(schema.channels.id, id));
  else
    await rt.db
      .insert(schema.channels)
      .values({ id, ownerId: userId, platform: "tiktok", externalId: grant.openId, ...values });
  await rt.db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "channel.connected",
    subjectId: id,
    data: { platform: "tiktok", externalId: grant.openId, title, scopes: grant.scopes },
  });
  return id;
}

type ChannelRow = typeof schema.channels.$inferSelect;

async function tiktokChannel(userId: string): Promise<ChannelRow | undefined> {
  const { db } = await runtime();
  return db.query.channels.findFirst({
    where: and(eq(schema.channels.ownerId, userId), eq(schema.channels.platform, "tiktok")),
    orderBy: desc(schema.channels.updatedAt),
  });
}

/** A fresh access token (TikTok's last 24 h). TikTok may rotate the refresh token: keep the newest. */
async function accessToken(rt: Runtime, tt: TikTokClient, ch: ChannelRow): Promise<string> {
  if (!ch.secret || ch.status !== "connected") throw new TikTokReconnectRequired();
  const aad = channelAad(ch.ownerId, ch.id);
  let refresh: string;
  try {
    refresh = rt.box.open(ch.secret, aad);
  } catch {
    return needsReconnect(rt, ch, "token unreadable");
  }
  try {
    const grant = await tt.refresh(refresh);
    await rt.db
      .update(schema.channels)
      .set({ secret: rt.box.seal(grant.refreshToken, aad), updatedAt: new Date().toISOString() })
      .where(eq(schema.channels.id, ch.id));
    return grant.accessToken;
  } catch (e) {
    if (e instanceof TikTokReconnectRequired) return needsReconnect(rt, ch, "grant expired or revoked");
    throw e;
  }
}

async function needsReconnect(rt: Runtime, ch: ChannelRow, reason: string): Promise<never> {
  await rt.db
    .update(schema.channels)
    .set({ status: "needs_reconnect", updatedAt: new Date().toISOString() })
    .where(eq(schema.channels.id, ch.id));
  await rt.db.insert(schema.auditEvents).values({
    ownerId: ch.ownerId,
    type: "channel.needs_reconnect",
    subjectId: ch.id,
    data: { platform: "tiktok", reason },
  });
  throw new TikTokReconnectRequired();
}

/** Revoke our access at TikTok (best effort) and forget the token; the row stays for publish history. */
export async function disconnectTikTok(userId: string, channelId: string) {
  const rt = await runtime();
  const tt = tiktokClient(rt);
  const ch = await rt.db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, userId)),
  });
  if (!ch || ch.platform !== "tiktok") throw new UserError("TikTok account not found");
  if (tt && ch.secret && ch.status === "connected") {
    try {
      await tt.revoke(await accessToken(rt, tt, ch));
    } catch {
      // already invalid: nothing left to revoke
    }
  }
  await rt.db
    .update(schema.channels)
    .set({ status: "disconnected", secret: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.channels.id, channelId));
  await rt.db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "channel.disconnected",
    subjectId: channelId,
    data: { platform: "tiktok" },
  });
}

const PRIVACY_TO_CONTRACT = {
  PUBLIC_TO_EVERYONE: "public",
  MUTUAL_FOLLOW_FRIENDS: "unlisted",
  FOLLOWER_OF_CREATOR: "unlisted",
  SELF_ONLY: "private",
} as const;

export const TikTokForm = z.object({
  title: z.string().max(TIKTOK_TITLE_MAX),
  privacyLevel: z.enum(TIKTOK_PRIVACY).optional(),
  allowComment: z.boolean(),
  allowDuet: z.boolean(),
  allowStitch: z.boolean(),
  commercial: z.boolean(),
  yourBrand: z.boolean(),
  brandedContent: z.boolean(),
  aiGenerated: z.boolean(),
  consent: z.boolean(),
}) satisfies z.ZodType<TikTokPostForm>;

export interface TikTokPublishView {
  id: string;
  status: string;
  url: string | null;
  error: string | null;
  privacy: string;
  createdAt: string;
}

/** Refresh in-flight posts from TikTok's status endpoint, then list this project's TikTok posts. */
async function tiktokPublishes(
  rt: Runtime,
  tt: TikTokClient | undefined,
  userId: string,
  projectId: string,
  ch?: ChannelRow,
  creator?: CreatorInfo,
) {
  const rows = await rt.db
    .select()
    .from(schema.publishRecords)
    .where(
      and(
        eq(schema.publishRecords.ownerId, userId),
        eq(schema.publishRecords.projectId, projectId),
        eq(schema.publishRecords.platform, "tiktok"),
      ),
    )
    .orderBy(desc(schema.publishRecords.createdAt));
  for (const r of rows) {
    if (r.status !== "uploading" || !r.externalId || !tt || !ch || ch.id !== r.channelId) continue;
    try {
      const s = await tt.postStatus(await accessToken(rt, tt, ch), r.externalId);
      if (s.status === "PUBLISH_COMPLETE") {
        const postId = s.postIds[0];
        r.status = "published";
        r.url = postId && creator?.username ? tiktokVideoUrl(creator.username, postId) : null;
        r.publishedAt = new Date().toISOString();
        await rt.db
          .update(schema.publishRecords)
          .set({ status: "published", url: r.url, publishedAt: r.publishedAt, updatedAt: r.publishedAt })
          .where(eq(schema.publishRecords.id, r.id));
        await recordAudit(rt.db, {
          ownerId: userId,
          type: "publish.completed",
          subjectId: r.id,
          data: {
            platform: "tiktok",
            channelId: r.channelId,
            publishId: r.externalId,
            postId: postId ?? null,
          },
        });
      } else if (s.status === "FAILED") {
        r.status = "failed";
        r.error = `TikTok couldn't publish it${s.failReason ? ` (${s.failReason})` : ""}.`;
        await rt.db
          .update(schema.publishRecords)
          .set({ status: "failed", error: r.error, updatedAt: new Date().toISOString() })
          .where(eq(schema.publishRecords.id, r.id));
        await recordAudit(rt.db, {
          ownerId: userId,
          type: "publish.failed",
          subjectId: r.id,
          data: { platform: "tiktok", channelId: r.channelId, error: r.error },
        });
      }
    } catch {
      // status is best effort; the next page load checks again
    }
  }
  return rows.map((r): TikTokPublishView => ({
    id: r.id,
    status: r.status,
    url: r.url,
    error: r.error,
    privacy: r.request.privacy,
    createdAt: r.createdAt,
  }));
}

/** Everything the TikTok post page needs. `creator_info` is fetched fresh on every view, as TikTok requires. */
export async function tiktokPostPage(userId: string, projectId: string) {
  const rt = await runtime();
  const tt = tiktokClient(rt);
  const view = await projectView(userId, projectId);
  const render = view.project.renderAssetId
    ? await rt.db.query.assets.findFirst({ where: eq(schema.assets.id, view.project.renderAssetId) })
    : undefined;
  const ch = await tiktokChannel(userId);
  let creator: CreatorInfo | undefined;
  let creatorError: string | undefined;
  const channel = ch && ch.status !== "disconnected" ? ch : undefined;
  if (tt && channel?.status === "connected") {
    try {
      creator = await tt.creatorInfo(await accessToken(rt, tt, channel));
    } catch (e) {
      creatorError =
        e instanceof TikTokReconnectRequired ||
        e instanceof TikTokCannotPost ||
        e instanceof TikTokRateLimited
          ? e.message
          : "We couldn't reach TikTok. Try again in a minute.";
    }
  }
  const fresh = channel ? await tiktokChannel(userId) : undefined;
  return {
    configured: Boolean(tt),
    audited: isAudited(),
    project: { id: view.project.id, title: view.project.title, status: view.project.status },
    approved: view.project.status === "approved" && Boolean(render),
    publishable: view.publishable,
    aiRequired: view.aiDisclosureRequired,
    videoUrl: view.videoUrl,
    thumbUrl: view.thumbUrl,
    videoDurationSec: (render?.durationMs ?? view.timeline?.durationMs ?? 0) / 1000,
    channel:
      fresh && fresh.status !== "disconnected"
        ? { id: fresh.id, title: fresh.title, status: fresh.status }
        : undefined,
    creator,
    creatorError,
    publishes: await tiktokPublishes(rt, tt, userId, projectId, channel, creator),
  };
}
export type TikTokPostPage = Awaited<ReturnType<typeof tiktokPostPage>>;

/**
 * Post the approved render to TikTok with Direct Post. Re-checks everything the form showed (creator_info, the
 * guideline rules, rights, variation) on the server; TikTok pulls the exact rendered file from a signed URL, so
 * nothing (no ShortLoop watermark) is added to the video.
 */
export async function postToTikTok(userId: string, projectId: string, input: z.input<typeof TikTokForm>) {
  const form = TikTokForm.parse(input);
  const { rt, tt } = await requireClient();
  const view = await projectView(userId, projectId);
  const p = view.project;
  if (p.status !== "approved" || !p.renderAssetId) throw new UserError("Approve the Short before posting.");
  if (!view.publishable.ok) throw new UserError(view.publishable.problems.join(" "));
  const script = p.scriptId
    ? await rt.db.query.scripts.findFirst({ where: eq(schema.scripts.id, p.scriptId) })
    : undefined;
  if (script) {
    const v = await checkVariation(rt.db, userId, script);
    const overridden = (await listOverrides(rt.db, userId)).some((o) => o.subjectId === script.id);
    if (!v.ok && !overridden) throw new UserError(v.reasons.join(" "));
  }
  const ch = await tiktokChannel(userId);
  if (!ch || ch.status === "disconnected") throw new UserError("Connect your TikTok account first.");
  if (ch.status === "needs_reconnect") throw new UserError(new TikTokReconnectRequired().message);
  const render = await rt.db.query.assets.findFirst({ where: eq(schema.assets.id, p.renderAssetId) });
  if (!render) throw new UserError("Rendered video not found.");

  const key = publishIdempotencyKey(p.renderAssetId, ch.id);
  const existing = await rt.db.query.publishRecords.findFirst({
    where: eq(schema.publishRecords.idempotencyKey, key),
  });
  if (existing && existing.status !== "failed")
    throw new UserError("This Short is already on that TikTok account.");

  try {
    const token = await accessToken(rt, tt, ch);
    const creator = await tt.creatorInfo(token);
    const ctx = {
      creator,
      audited: isAudited(),
      videoDurationSec: (render.durationMs ?? view.timeline?.durationMs ?? 0) / 1000,
      aiRequired: view.aiDisclosureRequired,
    };
    const problems = tiktokPostProblems(form, ctx);
    if (problems.length) throw new UserError(problems.join(" "));
    // The exact rendered MP4, unmodified: TikTok downloads it from this signed URL.
    // Local storage signs app-relative URLs; TikTok needs an absolute one.
    const videoUrl = new URL(await rt.storage.signedUrl(render.storageKey, 3600), appOrigin()).toString();
    const body = toDirectPost(form, ctx, token, videoUrl);
    const privacy = PRIVACY_TO_CONTRACT[body.privacyLevel];
    const request = PublishRequest.parse({
      platform: "tiktok",
      accountId: ch.id,
      videoAssetId: render.id,
      title: (form.title.trim() || p.title).slice(0, 100),
      description: form.title,
      tags: [],
      privacy,
      aiDisclosure: body.isAigc,
    });
    const { publishId } = await tt.directPost(body);
    const id = existing?.id ?? `pub_${randomUUID()}`;
    const values = {
      request,
      status: "uploading" as const,
      externalId: publishId,
      url: null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    if (existing)
      await rt.db.update(schema.publishRecords).set(values).where(eq(schema.publishRecords.id, id));
    else
      await rt.db.insert(schema.publishRecords).values({
        id,
        ownerId: userId,
        platform: "tiktok",
        channelId: ch.id,
        videoAssetId: render.id,
        projectId,
        idempotencyKey: key,
        ...values,
      });
    await recordAudit(rt.db, {
      ownerId: userId,
      type: "publish.requested",
      subjectId: id,
      data: {
        platform: "tiktok",
        channelId: ch.id,
        projectId,
        publishId,
        privacyLevel: body.privacyLevel,
        audited: ctx.audited,
        disableComment: body.disableComment,
        disableDuet: body.disableDuet,
        disableStitch: body.disableStitch,
        brandContentToggle: body.brandContentToggle,
        brandOrganicToggle: body.brandOrganicToggle,
        isAigc: body.isAigc,
        consent: form.consent,
      },
    });
    return id;
  } catch (e) {
    if (
      e instanceof TikTokReconnectRequired ||
      e instanceof TikTokCannotPost ||
      e instanceof TikTokRateLimited
    )
      throw new UserError(e.message);
    throw e;
  }
}

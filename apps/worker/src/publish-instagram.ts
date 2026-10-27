import { randomUUID } from "node:crypto";
import { PublishRequest } from "@shortloop/contracts";
import { and, eq, schema, type Db } from "@shortloop/db";
import { recordAudit, withAttribution, type JobHandler } from "@shortloop/pipeline";
import {
  assertProfessional,
  InstagramReconnectRequired,
  publishReel,
  type InstagramClient,
  type PublishReelOptions,
  type SecretBox,
  type Storage,
} from "@shortloop/providers";
import { channelAad, ChannelError } from "./channels";
import {
  newPublishTrace,
  PublishRefused,
  runPublishChecks,
  type PublishDeps,
  type PublishInput,
} from "./publish";

/** Instagram's caption limit. Attributions are kept; the user's text is trimmed to make room. */
export const INSTAGRAM_CAPTION_MAX = 2200;
/** Refresh the long-lived (60-day) token once it has less than this left. */
export const INSTAGRAM_REFRESH_BEFORE_MS = 7 * 86_400_000;

/** What `channels.secret` holds for an Instagram account (sealed): the long-lived token and when it expires. */
export interface InstagramSecret {
  accessToken: string;
  expiresAt: string;
}

export function sealInstagramToken(
  box: SecretBox,
  ownerId: string,
  channelId: string,
  grant: { accessToken: string; expiresInS: number },
  now = new Date(),
): string {
  const secret: InstagramSecret = {
    accessToken: grant.accessToken,
    expiresAt: new Date(now.getTime() + grant.expiresInS * 1000).toISOString(),
  };
  return box.seal(JSON.stringify(secret), channelAad(ownerId, channelId));
}

export function openInstagramToken(box: SecretBox, ownerId: string, channelId: string, sealed: string) {
  const v = JSON.parse(box.open(sealed, channelAad(ownerId, channelId))) as Partial<InstagramSecret>;
  if (typeof v.accessToken !== "string" || typeof v.expiresAt !== "string") throw new Error("bad secret");
  return v as InstagramSecret;
}

/**
 * OAuth callback for Instagram Login: exchange the code, then check the account is Professional before anything is
 * stored. Personal accounts throw `ProfessionalAccountRequired` (the "switch to Professional" message) and leave no
 * trace. The long-lived token is sealed in `channels.secret`; reconnecting the same account replaces it.
 */
export async function connectInstagramAccount(
  db: Db,
  box: SecretBox,
  ig: InstagramClient,
  ownerId: string,
  code: string,
  now = new Date(),
): Promise<string> {
  const grant = await ig.exchangeCode(code);
  const account = assertProfessional(await ig.me(grant.accessToken));
  const existing = await db.query.channels.findFirst({
    where: and(eq(schema.channels.platform, "instagram"), eq(schema.channels.externalId, account.userId)),
  });
  if (existing && existing.ownerId !== ownerId)
    throw new ChannelError("That Instagram account is already connected to another ShortLoop account.");
  const id = existing?.id ?? `ch_${randomUUID()}`;
  const values = {
    title: `@${account.username}`,
    avatarUrl: account.avatarUrl ?? null,
    secret: sealInstagramToken(box, ownerId, id, grant, now),
    scopes: grant.scopes.join(" "),
    status: "connected" as const,
    updatedAt: now.toISOString(),
  };
  if (existing) await db.update(schema.channels).set(values).where(eq(schema.channels.id, id));
  else
    await db
      .insert(schema.channels)
      .values({ id, ownerId, platform: "instagram", externalId: account.userId, ...values });
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "channel.connected",
    subjectId: id,
    data: {
      platform: "instagram",
      externalId: account.userId,
      title: values.title,
      accountType: account.accountType,
      scopes: grant.scopes,
    },
  });
  return id;
}

async function markNeedsReconnect(db: Db, ownerId: string, channelId: string, reason: string) {
  await db
    .update(schema.channels)
    .set({ status: "needs_reconnect", updatedAt: new Date().toISOString() })
    .where(eq(schema.channels.id, channelId));
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "channel.needs_reconnect",
    subjectId: channelId,
    data: { platform: "instagram", reason },
  });
}

/**
 * The account's long-lived token, refreshed (and re-sealed) when it has under 7 days left. An expired, revoked or
 * unreadable token flags the account so the UI asks to reconnect.
 */
export async function instagramAccessToken(
  db: Db,
  box: SecretBox,
  ig: InstagramClient,
  channelId: string,
  now = new Date(),
): Promise<{ accessToken: string; userId: string }> {
  const ch = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) });
  if (!ch || ch.platform !== "instagram" || ch.status === "disconnected" || !ch.secret)
    throw new InstagramReconnectRequired("This Instagram account isn't connected.");
  if (ch.status === "needs_reconnect") throw new InstagramReconnectRequired();
  let secret: InstagramSecret;
  try {
    secret = openInstagramToken(box, ch.ownerId, ch.id, ch.secret);
  } catch {
    await markNeedsReconnect(db, ch.ownerId, ch.id, "token unreadable");
    throw new InstagramReconnectRequired();
  }
  const left = new Date(secret.expiresAt).getTime() - now.getTime();
  if (left <= 0) {
    await markNeedsReconnect(db, ch.ownerId, ch.id, "token expired");
    throw new InstagramReconnectRequired();
  }
  if (left >= INSTAGRAM_REFRESH_BEFORE_MS) return { accessToken: secret.accessToken, userId: ch.externalId };
  try {
    const grant = await ig.refresh(secret.accessToken);
    await db
      .update(schema.channels)
      .set({ secret: sealInstagramToken(box, ch.ownerId, ch.id, grant, now), updatedAt: now.toISOString() })
      .where(eq(schema.channels.id, ch.id));
    await db.insert(schema.auditEvents).values({
      ownerId: ch.ownerId,
      type: "channel.token_refreshed",
      subjectId: ch.id,
      data: { platform: "instagram" },
    });
    return { accessToken: grant.accessToken, userId: ch.externalId };
  } catch (e) {
    if (e instanceof InstagramReconnectRequired) {
      await markNeedsReconnect(db, ch.ownerId, ch.id, "grant expired or revoked");
      throw e;
    }
    // A failed refresh with time still left: keep posting with the current token.
    return { accessToken: secret.accessToken, userId: ch.externalId };
  }
}

/** Caption = the user's text + licence attributions, within Instagram's 2,200 characters (attributions kept). */
export function instagramCaption(description: string, manifest: Parameters<typeof withAttribution>[1]) {
  const full = withAttribution(description, manifest);
  if (full.length <= INSTAGRAM_CAPTION_MAX) return full;
  const credits = full.slice(description.length);
  return withAttribution(description.slice(0, Math.max(0, INSTAGRAM_CAPTION_MAX - credits.length)), manifest);
}

export interface InstagramPublishDeps extends Pick<
  PublishDeps,
  "db" | "storage" | "fingerprint" | "requireMusicCheck"
> {
  box: SecretBox;
  instagram: InstagramClient;
  storage: Storage;
  /** Base for app-relative signed URLs (local storage); Instagram has to fetch the video itself. */
  publicBaseUrl?: string;
  /** Status polling and retry timing (tests shorten them). */
  reel?: PublishReelOptions;
  now?: () => Date;
}

/**
 * Job `publish` for `platform: "instagram"` (E8-04b): the same checks as YouTube (approved, rights, music,
 * variation), then `publishReel` with a signed render URL and the caption plus attributions. A rate limit or a
 * used-up 24-hour limit holds the post as `scheduled_next_window`; `requeueHeldPublishes` re-queues it after
 * `retryAt`. Container polling (once a minute, up to 5 minutes) is why this runs as a job, not in a request.
 */
export function instagramPublishHandler(deps: InstagramPublishDeps): JobHandler {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  return async ({ job, ownerId, onProgress }) => {
    const input = job.input as unknown as PublishInput;
    const req = PublishRequest.parse(input.request);
    const rec = await db.query.publishRecords.findFirst({
      where: eq(schema.publishRecords.id, input.publishId),
    });
    if (!rec || rec.ownerId !== ownerId || rec.platform !== "instagram")
      throw new PublishRefused("unknown publish record");
    if (rec.status === "published" && rec.externalId)
      return { status: rec.status, mediaId: rec.externalId, url: rec.url }; // already posted: never twice
    const set = (v: Partial<typeof schema.publishRecords.$inferInsert>) =>
      db
        .update(schema.publishRecords)
        .set({ ...v, updatedAt: now().toISOString() })
        .where(eq(schema.publishRecords.id, rec.id));

    const trace = newPublishTrace();
    try {
      const { manifest } = await runPublishChecks(deps, ownerId, input.projectId, req.videoAssetId, trace);
      await onProgress(0.1);
      const video = await db.query.assets.findFirst({ where: eq(schema.assets.id, req.videoAssetId) });
      if (!video) throw new PublishRefused("Rendered video not found.");
      const token = await instagramAccessToken(db, deps.box, deps.instagram, rec.channelId, now());
      // Instagram downloads the exact rendered file; the link has to outlive up to 5 minutes of processing.
      const signed = await deps.storage.signedUrl(video.storageKey, 3600);
      const videoUrl = new URL(signed, deps.publicBaseUrl ?? "http://localhost").toString();
      const caption = instagramCaption(req.description, manifest);
      await set({ status: "uploading", error: null, jobId: job.id });
      await onProgress(0.3);
      const result = await publishReel(
        deps.instagram,
        { accessToken: token.accessToken, userId: token.userId, videoUrl, caption, shareToFeed: true },
        { now, ...deps.reel },
      );
      if (result.status === "scheduled_next_window") {
        // Shown to the user on the post page; `requeueHeldPublishes` sends it again after `retryAt`.
        await set({ status: "scheduled_next_window", retryAt: result.retryAt, error: null });
        return { status: result.status, retryAt: result.retryAt, reason: result.reason };
      }
      const url = result.permalink ?? null;
      await set({
        status: "published",
        externalId: result.mediaId,
        url,
        publishedAt: now().toISOString(),
        retryAt: null,
      });
      await recordAudit(db, {
        ownerId,
        type: "publish.completed",
        subjectId: rec.id,
        jobId: job.id,
        data: {
          platform: "instagram",
          channelId: rec.channelId,
          mediaId: result.mediaId,
          status: "published",
          checks: trace.checks,
          assets: manifest.entries,
          musicMatches: trace.musicMatches,
        },
      });
      await onProgress(1);
      return { status: "published", mediaId: result.mediaId, url };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await set({ status: "failed", error: message });
      await recordAudit(db, {
        ownerId,
        type: "publish.failed",
        subjectId: rec.id,
        jobId: job.id,
        data: {
          platform: "instagram",
          channelId: rec.channelId,
          error: message,
          checks: trace.checks,
          assets: trace.assetsUsed,
          musicMatches: trace.musicMatches,
        },
      });
      throw e instanceof InstagramReconnectRequired || e instanceof PublishRefused
        ? new PublishRefused(message)
        : e;
    }
  };
}

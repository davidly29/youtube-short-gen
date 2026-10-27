import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset, PublishRequest, Timeline } from "@shortloop/contracts";
import { and, eq, gte, inArray, schema, toAsset, toTimeline, type Db } from "@shortloop/db";
import {
  assertPublishable,
  buildRightsManifest,
  checkVariation,
  DEFAULT_DAILY_UPLOAD_LIMIT,
  listOverrides,
  nextQuotaWindow,
  quotaDay,
  quotaDayStart,
  recordAudit,
  requiresAiDisclosure,
  type PublishChecks,
  type RightsEntry,
  youtubeMetadata,
  type JobHandler,
  type JobService,
} from "@shortloop/pipeline";
import {
  musicCheck,
  needsFingerprint,
  QuotaExceeded,
  ReconnectRequired,
  videoUrl,
  type Fingerprinter,
  type FingerprintResult,
  type SecretBox,
  type Storage,
  type YouTubeClient,
} from "@shortloop/providers";
import { channelAccessToken } from "./channels";

export interface PublishInput {
  publishId: string;
  projectId: string;
  request: PublishRequest;
}

/** A check refused the publish. Retrying can't change the answer, so the job fails on its first attempt. */
export class PublishRefused extends Error {
  readonly permanent = true;
}

export interface PublishDeps {
  db: Db;
  storage: Storage;
  box: SecretBox;
  youtube: YouTubeClient;
  /** Uploads per Pacific day across the deployment's Google project (default 100). */
  dailyLimit?: number;
  /** Audio recognition for user-supplied audio (E13-03). Without it the check is recorded as `skipped`. */
  fingerprint?: Fingerprinter;
  /** Refuse to publish user-supplied audio when no recognition service is configured (FINGERPRINT_REQUIRED=1). */
  requireMusicCheck?: boolean;
  now?: () => Date;
}

export const MUSIC_CHECK_UNAVAILABLE =
  "Uploaded audio has to be checked for commercial music before publishing, and that check isn't set up on this server.";

const nowIso = (d: Date) => d.toISOString();

async function uploadsToday(db: Db, now: Date): Promise<number> {
  const rows = await db
    .select({ id: schema.publishRecords.id })
    .from(schema.publishRecords)
    .where(
      and(
        eq(schema.publishRecords.platform, "youtube"),
        inArray(schema.publishRecords.status, ["published", "scheduled", "uploading"]),
        gte(schema.publishRecords.updatedAt, nowIso(quotaDayStart(now))),
      ),
    );
  return rows.length;
}

/** What the publish checks found so far; kept even when one fails, for the audit log (E13-02). */
export interface PublishTrace {
  checks: PublishChecks;
  assetsUsed: RightsEntry[];
  musicMatches: unknown[];
}

export const newPublishTrace = (): PublishTrace => ({
  checks: { rights: "pending", variation: "pending", music: "pending" },
  assetsUsed: [],
  musicMatches: [],
});

/**
 * The checks every platform runs before posting (YouTube E8-02, Instagram E8-04b): approved, the latest render,
 * every asset licensed (`assertPublishable`), no commercial music in user audio (E13-03), and not a near-duplicate
 * (`checkVariation`) unless the user overrode it. Refusals throw `PublishRefused`; `trace` records what was found.
 */
export async function runPublishChecks(
  deps: Pick<PublishDeps, "db" | "storage" | "fingerprint" | "requireMusicCheck">,
  ownerId: string,
  projectId: string,
  videoAssetId: string,
  trace: PublishTrace,
) {
  const { db } = deps;
  const { checks } = trace;
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project || project.ownerId !== ownerId) throw new PublishRefused("project not found");
  if (project.status !== "approved") throw new PublishRefused("Approve the Short before publishing.");
  if (project.renderAssetId !== videoAssetId)
    throw new PublishRefused("That video isn't this project's latest render.");
  const tlRow = project.timelineId
    ? await db.query.timelines.findFirst({ where: eq(schema.timelines.id, project.timelineId) })
    : undefined;
  if (!tlRow) throw new PublishRefused("No timeline to check.");
  const timeline = Timeline.parse(toTimeline(tlRow));
  const ids = [...new Set([...timeline.video, ...timeline.audio].map((c) => c.assetId))];
  const assets = (await db.select().from(schema.assets).where(inArray(schema.assets.id, ids))).map((a) =>
    Asset.parse(toAsset(a)),
  );
  const manifest = buildRightsManifest(timeline, assets);
  trace.assetsUsed = manifest.entries;
  try {
    assertPublishable(manifest);
  } catch (e) {
    checks.rights = "failed";
    throw e;
  }
  checks.rights = "passed";
  // Commercial music in user-supplied audio blocks the publish (E13-03). Video clips render muted.
  const audioIds = new Set(timeline.audio.map((c) => c.assetId));
  const toCheck = assets.filter((a) => audioIds.has(a.id) && needsFingerprint(a));
  if (toCheck.length === 0) checks.music = "passed";
  else if (!deps.fingerprint) {
    checks.music = "skipped";
    if (deps.requireMusicCheck) throw new PublishRefused(MUSIC_CHECK_UNAVAILABLE);
  } else {
    const fp = deps.fingerprint;
    const results: { asset: Asset; result: FingerprintResult }[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "music-"));
    try {
      for (const [i, a] of toCheck.entries()) {
        const file = join(tmp, `audio-${i}`);
        await deps.storage.getFile(a.storageKey, file);
        results.push({ asset: a, result: await fp.fingerprint(a, file) });
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    const music = musicCheck(results);
    trace.musicMatches = music.matches;
    checks.music = music.ok ? "passed" : "failed";
    if (!music.ok) throw new PublishRefused(music.problems.join(" "));
  }
  const script = project.scriptId
    ? await db.query.scripts.findFirst({ where: eq(schema.scripts.id, project.scriptId) })
    : undefined;
  if (script) {
    const v = await checkVariation(db, ownerId, script);
    const overridden = (await listOverrides(db, ownerId)).some((o) => o.subjectId === script.id);
    checks.variation = v.ok ? "passed" : overridden ? "overridden" : "failed";
    if (!v.ok && !overridden) throw new PublishRefused(v.reasons.join(" "));
  } else {
    checks.variation = "passed"; // nothing to compare
  }
  return { project, timeline, assets, manifest };
}

/**
 * Job `publish`: checks first (approved, rights, variation), then a resumable upload. Quota exhaustion holds the
 * post for the next quota window instead of failing; a retry resumes the saved session, never re-uploads.
 */
export function publishHandler(deps: PublishDeps): JobHandler {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  return async ({ job, ownerId, onProgress }) => {
    const input = job.input as unknown as PublishInput;
    const req = PublishRequest.parse(input.request);
    const rec = await db.query.publishRecords.findFirst({
      where: eq(schema.publishRecords.id, input.publishId),
    });
    if (!rec || rec.ownerId !== ownerId) throw new PublishRefused("unknown publish record");
    if ((rec.status === "published" || rec.status === "scheduled") && rec.externalId) {
      return { status: rec.status, videoId: rec.externalId, url: rec.url }; // already done: never upload twice
    }
    const set = (v: Partial<typeof schema.publishRecords.$inferInsert>) =>
      db
        .update(schema.publishRecords)
        .set({ ...v, updatedAt: nowIso(now()) })
        .where(eq(schema.publishRecords.id, rec.id));

    // What the checks found, recorded with the outcome so a publish can be explained later (E13-02).
    const trace = newPublishTrace();
    const { checks } = trace;
    try {
      const { project, timeline, assets, manifest } = await runPublishChecks(
        deps,
        ownerId,
        input.projectId,
        req.videoAssetId,
        trace,
      );
      await onProgress(0.1);

      // 2. Quota: hold for the next window rather than fail.
      const limit = deps.dailyLimit ?? DEFAULT_DAILY_UPLOAD_LIMIT;
      if ((await uploadsToday(db, now())) >= limit) return await holdForNextWindow();

      // 3. Upload (resumable; the session is saved before any bytes move).
      const accessToken = await channelAccessToken(db, deps.box, deps.youtube, rec.channelId);
      const voice = assets.find((a) => a.kind === "audio" && timeline.audio[0]?.assetId === a.id);
      const metadata = youtubeMetadata(
        req,
        manifest,
        requiresAiDisclosure({
          manifest,
          imageStyle: project.settings.imageStyle,
          voiceProvider: voice?.licence.provider,
        }),
      );
      const video = await db.query.assets.findFirst({ where: eq(schema.assets.id, req.videoAssetId) });
      if (!video) throw new PublishRefused("Rendered video not found.");
      await set({ status: "uploading", error: null, jobId: job.id });
      const dir = await mkdtemp(join(tmpdir(), "publish-"));
      let videoId: string;
      try {
        const file = join(dir, "short.mp4");
        await deps.storage.getFile(video.storageKey, file);
        await onProgress(0.3);
        ({ videoId } = await deps.youtube.upload({
          accessToken,
          filePath: file,
          metadata,
          sessionUrl: rec.uploadUrl ?? undefined,
          onSession: (url) => set({ uploadUrl: url }).then(() => undefined),
        }));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      const status = metadata.publishAt ? "scheduled" : "published";
      const url = videoUrl(videoId);
      await set({
        status,
        externalId: videoId,
        url,
        publishedAt: metadata.publishAt ?? nowIso(now()),
        retryAt: null,
      });
      await recordAudit(db, {
        ownerId,
        type: "publish.completed",
        subjectId: rec.id,
        jobId: job.id,
        data: {
          platform: "youtube",
          channelId: rec.channelId,
          videoId,
          status,
          containsSyntheticMedia: metadata.containsSyntheticMedia,
          checks,
          assets: manifest.entries,
          musicMatches: trace.musicMatches,
        },
      });
      await onProgress(1);
      return { status, videoId, url, containsSyntheticMedia: metadata.containsSyntheticMedia };
    } catch (e) {
      if (e instanceof QuotaExceeded) return await holdForNextWindow();
      const message =
        e instanceof ReconnectRequired
          ? "YouTube access expired. Reconnect the channel, then publish again."
          : e instanceof Error
            ? e.message
            : String(e);
      await set({ status: "failed", error: message });
      await recordAudit(db, {
        ownerId,
        type: "publish.failed",
        subjectId: rec.id,
        jobId: job.id,
        data: {
          platform: "youtube",
          channelId: rec.channelId,
          error: message,
          checks,
          assets: trace.assetsUsed,
          musicMatches: trace.musicMatches,
        },
      });
      throw e instanceof ReconnectRequired || e instanceof PublishRefused ? new PublishRefused(message) : e;
    }

    async function holdForNextWindow() {
      const retryAt = nextQuotaWindow(now());
      await set({ status: "scheduled_next_window", retryAt: nowIso(retryAt), error: null });
      return { status: "scheduled_next_window", retryAt: nowIso(retryAt) };
    }
  };
}

/** Re-queue posts held for quota (YouTube) or a rate limit (Instagram) once their window opens. Call periodically (the worker does every 10 minutes). */
export async function requeueHeldPublishes(db: Db, jobs: JobService, now = new Date()): Promise<number> {
  const due = (
    await db
      .select()
      .from(schema.publishRecords)
      .where(eq(schema.publishRecords.status, "scheduled_next_window"))
  ).filter((r) => r.retryAt && new Date(r.retryAt).getTime() <= now.getTime());
  for (const r of due) {
    const job = await jobs.enqueue(
      "publish",
      { publishId: r.id, projectId: r.projectId, request: r.request },
      // Keyed by the window, so a post held more than once a day (Instagram's hourly retry) gets a new job.
      { idempotencyKey: `${r.idempotencyKey}:window:${r.retryAt ?? quotaDay(now)}`, ownerId: r.ownerId },
    );
    await db
      .update(schema.publishRecords)
      .set({ status: "queued", jobId: job.id, updatedAt: now.toISOString() })
      .where(eq(schema.publishRecords.id, r.id));
  }
  return due.length;
}

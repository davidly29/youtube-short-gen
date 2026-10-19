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
  QuotaExceeded,
  ReconnectRequired,
  videoUrl,
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

export class PublishRefused extends Error {}

export interface PublishDeps {
  db: Db;
  storage: Storage;
  box: SecretBox;
  youtube: YouTubeClient;
  /** Uploads per Pacific day across the deployment's Google project (default 100). */
  dailyLimit?: number;
  now?: () => Date;
}

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
    const checks: PublishChecks = { rights: "pending", variation: "pending" };
    let assetsUsed: RightsEntry[] = [];
    try {
      // 1. Checks: approved, every asset licensed, not a near-duplicate (unless the user overrode it, logged).
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, input.projectId) });
      if (!project || project.ownerId !== ownerId) throw new PublishRefused("project not found");
      if (project.status !== "approved") throw new PublishRefused("Approve the Short before publishing.");
      if (project.renderAssetId !== req.videoAssetId)
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
      assetsUsed = manifest.entries;
      try {
        assertPublishable(manifest);
      } catch (e) {
        checks.rights = "failed";
        throw e;
      }
      checks.rights = "passed";
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
        data: { platform: "youtube", channelId: rec.channelId, error: message, checks, assets: assetsUsed },
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

/** Re-queue posts held for quota once their window opens. Call periodically (the worker does every 10 minutes). */
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
      { idempotencyKey: `${r.idempotencyKey}:window:${quotaDay(now)}`, ownerId: r.ownerId },
    );
    await db
      .update(schema.publishRecords)
      .set({ status: "queued", jobId: job.id, updatedAt: now.toISOString() })
      .where(eq(schema.publishRecords.id, r.id));
  }
  return due.length;
}

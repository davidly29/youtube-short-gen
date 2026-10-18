import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset, Timeline } from "@shortloop/contracts";
import { schema, eq, inArray, toTimeline, type Db, toAsset as dbToAsset } from "@shortloop/db";
import { assertPublishable, buildRightsManifest, settle, type JobHandler } from "@shortloop/pipeline";
import type { Storage } from "@shortloop/providers";
import {
  buildAss,
  checkDeliverySpec,
  ffmpeg,
  fixtureTimeline,
  makeFixtureAssets,
  renderTimeline,
  type ResolvedAsset,
} from "@shortloop/render";

export interface RenderInput {
  /** Render the built-in 3 s fixture (smoke test for the media stack). */
  fixture?: boolean;
  timelineId?: string;
  /** Present when part of a production: settle the credit reserved on this job. */
  chain?: { creditJobId: string };
}

const toContract = (r: typeof schema.assets.$inferSelect): Asset => Asset.parse(dbToAsset(r));

/**
 * Timeline -> rights check -> captions -> MP4 + thumbnail (hook frame) + rights manifest JSON in storage,
 * a `render` asset row, and credits settled. Failures are refunded by the job service.
 */
export function renderHandler(storage: Storage, db?: Db): JobHandler {
  return async ({ job, ownerId, onProgress }) => {
    const input = job.input as RenderInput;
    const work = await mkdtemp(join(tmpdir(), "render-job-"));
    try {
      const out = join(work, "out.mp4");
      if (input.fixture) {
        const fixtures = await makeFixtureAssets(work);
        await renderTimeline(
          fixtureTimeline,
          async (id) => {
            const a = fixtures[id];
            if (!a) throw new Error(`no fixture asset ${id}`);
            return a;
          },
          out,
        );
        const problems = await checkDeliverySpec(out, fixtureTimeline.durationMs);
        if (problems.length) throw new Error(`render failed delivery spec: ${problems.join("; ")}`);
        const storageKey = `renders/${job.id}.mp4`;
        await storage.putFile(storageKey, out, "video/mp4");
        return { storageKey, durationMs: fixtureTimeline.durationMs };
      }

      if (!db || !input.timelineId) throw new Error("render needs a timelineId");
      const row = await db.query.timelines.findFirst({ where: eq(schema.timelines.id, input.timelineId) });
      if (!row) throw new Error(`unknown timeline ${input.timelineId}`);
      const timeline = Timeline.parse(toTimeline(row));
      const ids = [...new Set([...timeline.video, ...timeline.audio].map((c) => c.assetId))];
      const rows = await db.select().from(schema.assets).where(inArray(schema.assets.id, ids));
      const assets = rows.map(toContract);
      const manifest = buildRightsManifest(timeline, assets);
      assertPublishable(manifest);
      await onProgress(0.05);

      const byId = new Map(assets.map((a) => [a.id, a]));
      const resolve = async (id: string): Promise<ResolvedAsset> => {
        const a = byId.get(id);
        if (!a) throw new Error(`timeline references unknown asset ${id}`);
        const local = join(work, "assets", `${id}.${a.storageKey.split(".").pop() ?? "bin"}`);
        await storage.getFile(a.storageKey, local);
        return { path: local, kind: a.kind };
      };
      const ass = join(work, "captions.ass");
      await writeFile(ass, buildAss(timeline.captions, timeline.captionStyle));
      await renderTimeline(timeline, resolve, out, {
        subtitlesPath: timeline.captions.length ? ass : undefined,
      });
      await onProgress(0.85);
      const problems = await checkDeliverySpec(out, timeline.durationMs);
      if (problems.length) throw new Error(`render failed delivery spec: ${problems.join("; ")}`);

      const thumb = join(work, "thumb.jpg");
      const hookFrameMs = Math.min(500, timeline.durationMs - 100);
      await ffmpeg(["-ss", (hookFrameMs / 1000).toFixed(3), "-i", out, "-frames:v", "1", "-q:v", "3", thumb]);
      const manifestPath = join(work, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const id = `vid_${randomUUID()}`;
      const storageKey = `renders/${ownerId}/${id}.mp4`;
      const manifestKey = `renders/${ownerId}/${id}.rights.json`;
      const thumbnailKey = `renders/${ownerId}/${id}.jpg`;
      await storage.putFile(storageKey, out, "video/mp4");
      await storage.putFile(manifestKey, manifestPath, "application/json");
      await storage.putFile(thumbnailKey, thumb, "image/jpeg");
      await db.insert(schema.assets).values({
        id,
        ownerId,
        kind: "video",
        source: "render",
        licence: { type: "composed" },
        storageKey,
        durationMs: timeline.durationMs,
        width: 1080,
        height: 1920,
      });
      if (input.chain?.creditJobId) await settle(db, input.chain.creditJobId, { short: 1 });
      return { videoAssetId: id, storageKey, manifestKey, thumbnailKey, durationMs: timeline.durationMs };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };
}

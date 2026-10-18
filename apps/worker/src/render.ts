import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Timeline } from "@shortloop/contracts";
import type { JobHandler } from "@shortloop/pipeline";
import type { Storage } from "@shortloop/providers";
import {
  checkDeliverySpec,
  fixtureTimeline,
  makeFixtureAssets,
  renderTimeline,
  type ResolvedAsset,
} from "@shortloop/render";

export interface RenderInput {
  /** Render the built-in 3 s fixture (smoke test for the media stack). */
  fixture?: boolean;
  timeline?: unknown;
  /** assetId -> storage key + kind, for assets referenced by the timeline. */
  assets?: Record<string, { storageKey: string; kind: ResolvedAsset["kind"] }>;
}

/** Renders a Timeline (or the fixture), checks the delivery spec, uploads the MP4 to storage. */
export function renderHandler(storage: Storage): JobHandler {
  return async ({ job, onProgress }) => {
    const input = job.input as RenderInput;
    const work = await mkdtemp(join(tmpdir(), "render-job-"));
    try {
      let timeline: Timeline;
      let resolve: (id: string) => Promise<ResolvedAsset>;
      if (input.fixture) {
        const fixtures = await makeFixtureAssets(work);
        timeline = fixtureTimeline;
        resolve = async (id) => {
          const a = fixtures[id];
          if (!a) throw new Error(`no fixture asset ${id}`);
          return a;
        };
      } else {
        timeline = Timeline.parse(input.timeline);
        const assets = input.assets ?? {};
        resolve = async (id) => {
          const ref = assets[id];
          if (!ref) throw new Error(`timeline references unknown asset ${id}`);
          const local = join(work, "assets", id);
          await storage.getFile(ref.storageKey, local);
          return { path: local, kind: ref.kind };
        };
      }
      await onProgress(0.1);
      const out = join(work, "out.mp4");
      await renderTimeline(timeline, resolve, out);
      await onProgress(0.8);
      const problems = await checkDeliverySpec(out, timeline.durationMs);
      if (problems.length > 0) throw new Error(`render failed delivery spec: ${problems.join("; ")}`);
      const storageKey = `renders/${job.id}.mp4`;
      await storage.putFile(storageKey, out, "video/mp4");
      return { storageKey, durationMs: timeline.durationMs };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };
}

import type { Asset, Job, PublishRequest, Script, Timeline } from "@shortloop/contracts";
import type { assets, jobs, publishRecords, scripts, timelines } from "./schema";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const iso = (ts: string) => new Date(ts).toISOString();

/** Convert database rows into contract shapes. Callers validate with the Zod schema at trust boundaries. */
export const toAsset = (r: Row<typeof assets>): Asset => ({
  id: r.id,
  ownerId: r.ownerId,
  kind: r.kind,
  source: r.source,
  licence: r.licence,
  storageKey: r.storageKey,
  title: opt(r.title),
  durationMs: opt(r.durationMs),
  width: opt(r.width),
  height: opt(r.height),
  createdAt: iso(r.createdAt),
});

export const toScript = (r: Row<typeof scripts>): Script => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  hook: r.hook,
  beats: r.beats,
  cta: r.cta,
  language: r.language,
  wordCount: r.wordCount,
});

export const toTimeline = (r: Row<typeof timelines>): Timeline =>
  ({
    id: r.id,
    fps: r.fps,
    width: r.width,
    height: r.height,
    durationMs: r.durationMs,
    video: r.video,
    audio: r.audio,
    captions: r.captions,
    captionStyle: r.captionStyle,
  }) as Timeline;

export const toJob = (r: Row<typeof jobs>): Job => ({
  id: r.id,
  type: r.type,
  status: r.status,
  progress: r.progress,
  input: r.input,
  output: opt(r.output),
  error: opt(r.error),
  costCredits: r.costCredits,
  idempotencyKey: r.idempotencyKey,
});

export const toPublishRequest = (r: Row<typeof publishRecords>): PublishRequest => r.request;

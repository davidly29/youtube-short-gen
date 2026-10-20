import { randomUUID } from "node:crypto";
import { Asset, type CaptionStyleId, type CaptionWord } from "@shortloop/contracts";
import { schema, eq, inArray, type Db, toAsset as dbToAsset } from "@shortloop/db";
import {
  assembleTimeline,
  beatSpans,
  chooseClips,
  TAIL_MS,
  type JobHandler,
  type VisualCandidate,
} from "@shortloop/pipeline";
import {
  generateImageAsset,
  importStock,
  type ImageGen,
  type StockProvider,
  type Storage,
} from "@shortloop/providers";

export interface VisualsInput {
  scriptId: string;
  voice: { audioAssetId: string; durationMs: number; words: CaptionWord[] };
  captionStyle: CaptionStyleId;
  /** The user's own library assets they want considered (preferred over stock). */
  libraryAssetIds?: string[];
  musicAssetId?: string;
  imageStyle?: string;
}

const toContract = (r: typeof schema.assets.$inferSelect): Asset => Asset.parse(dbToAsset(r));

async function saveAsset(db: Db, a: Asset): Promise<void> {
  await db.insert(schema.assets).values({
    id: a.id,
    ownerId: a.ownerId,
    kind: a.kind,
    source: a.source,
    licence: a.licence,
    storageKey: a.storageKey,
    durationMs: a.durationMs ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  });
}

/**
 * For each beat: the user's library (if given), then licensed stock, then an AI image as the fallback.
 * Then assemble and save the Timeline (E6-01). Output: { timelineId }.
 */
export function visualsHandler(
  db: Db,
  storage: Storage,
  stock: StockProvider[],
  image: ImageGen | undefined,
  fetchImpl: typeof fetch = fetch,
): JobHandler {
  return async ({ job, ownerId, onProgress }) => {
    const input = job.input as unknown as VisualsInput;
    const script = await db.query.scripts.findFirst({ where: eq(schema.scripts.id, input.scriptId) });
    if (!script) throw new Error(`unknown script ${input.scriptId}`);
    const endMs = input.voice.durationMs + TAIL_MS;
    const spans = beatSpans(script, input.voice.words, endMs);

    const library = input.libraryAssetIds?.length
      ? (
          await db.select().from(schema.assets).where(inArray(schema.assets.id, input.libraryAssetIds))
        ).filter((a) => a.ownerId === ownerId)
      : [];

    const candidates: Record<string, VisualCandidate[]> = {};
    let lastError: unknown;
    for (const [i, span] of spans.entries()) {
      const list: VisualCandidate[] = library
        .filter((a) => a.kind !== "audio")
        .map((a) => ({
          asset: toContract(a),
          origin: "library" as const,
          description: `${a.title ?? ""} ${a.licence.prompt ?? ""}`,
        }));
      for (const provider of stock) {
        try {
          const results = await provider.search({
            query: span.visualQuery,
            kind: "image",
            orientation: "portrait",
            perPage: 3,
          });
          const top = results.find((r) => !r.needsCrop) ?? results[0];
          if (top) {
            const a = await importStock(top, ownerId, storage, fetchImpl);
            await saveAsset(db, a);
            list.push({ asset: a, origin: "stock", description: `${span.visualQuery} ${top.pageUrl}` });
            break;
          }
        } catch {
          // a failing stock provider shouldn't sink the Short; fall through to the next source
        }
      }
      if (!list.some((c) => c.origin !== "library") && image) {
        try {
          const a = await generateImageAsset(image, storage, ownerId, {
            prompt: span.visualQuery,
            aspect: "9:16",
            style: input.imageStyle,
          });
          await saveAsset(db, a);
          list.push({ asset: a, origin: "ai", description: a.licence.prompt ?? span.visualQuery });
        } catch (e) {
          // One beat's image failing (even after the free fallback) shouldn't sink the whole Short (ADR 0007).
          lastError = e;
        }
      }
      candidates[span.beatId] = list;
      await onProgress(0.1 + (0.8 * (i + 1)) / spans.length);
    }

    const covered = spans.filter((s) => candidates[s.beatId]?.length);
    if (covered.length === 0) {
      if (lastError) throw lastError;
      throw new Error("No visuals could be found or made for this Short.");
    }
    const clips = stretchOverGaps(chooseClips(covered, candidates), spans);
    const gaps = spans.length - covered.length;
    const timeline = assembleTimeline({
      timelineId: `tl_${randomUUID()}`,
      script,
      voice: {
        assetId: input.voice.audioAssetId,
        durationMs: input.voice.durationMs,
        words: input.voice.words,
      },
      clips,
      music: input.musicAssetId ? { assetId: input.musicAssetId } : undefined,
      captionStyle: input.captionStyle,
    });
    await db.insert(schema.timelines).values({ ...timeline, projectId: script.projectId });
    return {
      timelineId: timeline.id,
      clips: clips.length,
      durationMs: timeline.durationMs,
      ...(gaps ? { beatsWithoutOwnImage: gaps } : {}),
    };
  };
}

/**
 * When some beats have no visual, extend the neighbouring clips so the video track still covers every beat
 * with no gaps: each clip runs until the next one starts; the first starts where the first beat does.
 */
export function stretchOverGaps<C extends { startMs: number; endMs: number }>(
  clips: C[],
  spans: { startMs: number; endMs: number }[],
): C[] {
  if (clips.length === 0 || spans.length === 0) return clips;
  const start = spans[0]?.startMs ?? 0;
  const end = spans[spans.length - 1]?.endMs ?? 0;
  return clips.map((c, i) => ({
    ...c,
    startMs: i === 0 ? start : c.startMs,
    endMs: i === clips.length - 1 ? end : (clips[i + 1]?.startMs ?? c.endMs),
  }));
}

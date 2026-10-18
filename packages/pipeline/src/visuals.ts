import type { Asset, CaptionWord, Clip, Script } from "@shortloop/contracts";

export const MIN_CLIP_MS = 800;
export const FRAME_MS = 1000 / 30;

export interface BeatSpan {
  beatId: string;
  visualQuery: string;
  startMs: number;
  endMs: number;
}

const wordCount = (s: string) => s.match(/\S+/g)?.length ?? 0;

/**
 * When each beat is on screen, from the narration's word timings. Narration = beats in order + CTA,
 * so beat i starts at its first word; beat 0 starts at 0 and the last beat runs to `endMs`
 * (it also covers the CTA). Beats shorter than MIN_CLIP_MS are merged into the previous one.
 */
export function beatSpans(script: Pick<Script, "beats">, words: CaptionWord[], endMs: number): BeatSpan[] {
  const starts: number[] = [];
  let idx = 0;
  for (const beat of script.beats) {
    starts.push(idx === 0 ? 0 : (words[idx]?.startMs ?? words[words.length - 1]?.endMs ?? 0));
    idx += wordCount(beat.text);
  }
  const spans: BeatSpan[] = script.beats.map((b, i) => ({
    beatId: b.id,
    visualQuery: b.visualQuery,
    startMs: Math.round(starts[i] ?? 0),
    endMs: Math.round(i + 1 < starts.length ? (starts[i + 1] ?? endMs) : endMs),
  }));
  const merged: BeatSpan[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s.endMs - s.startMs < MIN_CLIP_MS) prev.endMs = s.endMs;
    else if (!prev && s.endMs - s.startMs < MIN_CLIP_MS && spans.length > 1) merged.push({ ...s });
    else merged.push({ ...s });
  }
  // A too-short first span is absorbed by the next one.
  if (merged.length > 1 && (merged[0]?.endMs ?? 0) - (merged[0]?.startMs ?? 0) < MIN_CLIP_MS) {
    const [first, second] = merged;
    if (first && second) {
      second.startMs = first.startMs;
      merged.shift();
    }
  }
  return merged;
}

export type CandidateOrigin = "library" | "stock" | "ai";

export interface VisualCandidate {
  asset: Asset;
  origin: CandidateOrigin;
  /** Text describing the media (stock title/tags, AI prompt, upload name) used for scoring. */
  description: string;
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((t) => t.length > 2) ?? [],
  );

/**
 * Text relevance in [0, 1] (share of query terms found in the description).
 * Stand-in for CLIP-style text–image similarity; swap in an embedding scorer later without changing callers.
 */
export function relevance(query: string, description: string): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const d = tokens(description);
  let hit = 0;
  for (const t of q) if (d.has(t)) hit++;
  return hit / q.size;
}

const ORIGIN_RANK: Record<CandidateOrigin, number> = { library: 0, stock: 1, ai: 2 };
/** A library item that doesn't match the beat at all ranks after stock and AI (it's still a last resort). */
const IRRELEVANT_LIBRARY_RANK = 3;
const reusable = (a: Asset) => a.source === "upload" || a.source === "own_channel";

/**
 * Pick one clip per beat: prefer the user's library, then stock, then AI images (in that order),
 * highest relevance within an origin; never reuse an asset in one Short unless it is the user's own.
 * Library items only take precedence on beats they match (relevance > 0), and an unused library
 * item beats one already on screen, so a handful of uploads spread across the Short.
 */
export function chooseClips(spans: BeatSpan[], candidates: Record<string, VisualCandidate[]>): Clip[] {
  const used = new Set<string>();
  return spans.map((span) => {
    const rank = (c: VisualCandidate) =>
      c.origin === "library" && relevance(span.visualQuery, c.description) === 0
        ? IRRELEVANT_LIBRARY_RANK
        : ORIGIN_RANK[c.origin];
    const options = [...(candidates[span.beatId] ?? [])]
      .filter((c) => reusable(c.asset) || !used.has(c.asset.id))
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          Number(used.has(a.asset.id)) - Number(used.has(b.asset.id)) ||
          relevance(span.visualQuery, b.description) - relevance(span.visualQuery, a.description),
      );
    const pick = options[0];
    if (!pick) throw new Error(`no visual available for beat ${span.beatId} ("${span.visualQuery}")`);
    used.add(pick.asset.id);
    return {
      assetId: pick.asset.id,
      startMs: span.startMs,
      endMs: span.endMs,
      srcInMs: 0,
      fit: "cover",
      motion: pick.asset.kind === "image" ? "kenburns" : "none",
    };
  });
}

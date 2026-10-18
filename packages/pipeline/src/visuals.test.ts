import type { Asset, CaptionWord } from "@shortloop/contracts";
import { describe, expect, it } from "vitest";
import { beatSpans, chooseClips, FRAME_MS, MIN_CLIP_MS, relevance, type VisualCandidate } from "./visuals";

const script = {
  beats: [
    { id: "b1", text: "Why three hearts?", visualQuery: "octopus close up", estDurationMs: 0 },
    {
      id: "b2",
      text: "Two pump blood to the gills.",
      visualQuery: "octopus gills diagram",
      estDurationMs: 0,
    },
    { id: "b3", text: "Ok.", visualQuery: "ocean", estDurationMs: 0 },
    { id: "b4", text: "The third feeds the body.", visualQuery: "octopus swimming", estDurationMs: 0 },
  ],
};
const words: CaptionWord[] = [
  "Why",
  "three",
  "hearts?",
  "Two",
  "pump",
  "blood",
  "to",
  "the",
  "gills.",
  "Ok.",
  "The",
  "third",
  "feeds",
  "the",
  "body.",
  "Follow",
  "now.",
].map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 350, emphasis: false }));

const at = "2026-10-18T00:00:00Z";
const asset = (id: string, source: Asset["source"], kind: Asset["kind"] = "image"): Asset => ({
  id,
  ownerId: "u",
  kind,
  source,
  storageKey: id,
  createdAt: at,
  licence:
    source === "upload"
      ? { type: "owned", attestedByUserAt: at }
      : { type: source === "stock" ? "stock" : "ai_generated" },
});
const cand = (a: Asset, origin: VisualCandidate["origin"], description: string): VisualCandidate => ({
  asset: a,
  origin,
  description,
});

describe("beatSpans", () => {
  const spans = beatSpans(script, words, 7000);
  it("aligns each beat to its first word (±1 frame) and runs the last beat to the end", () => {
    expect(spans[0]?.startMs).toBe(0);
    expect(Math.abs((spans[1]?.startMs ?? 0) - (words[3]?.startMs ?? 0))).toBeLessThanOrEqual(FRAME_MS);
    expect(spans.at(-1)?.endMs).toBe(7000);
    spans.forEach((s, i) => i > 0 && expect(s.startMs).toBe(spans[i - 1]?.endMs));
  });
  it("never produces a clip shorter than 0.8 s (short beats merge into the previous)", () => {
    expect(spans.map((s) => s.beatId)).toEqual(["b1", "b2", "b4"]);
    expect(spans.every((s) => s.endMs - s.startMs >= MIN_CLIP_MS)).toBe(true);
  });
});

describe("chooseClips", () => {
  const spans = beatSpans(script, words, 7000);
  const own = asset("own", "upload", "video");
  const stockA = asset("stockA", "stock");
  const stockB = asset("stockB", "stock");
  const ai = asset("ai1", "ai_generated");

  it("prefers library, then stock, then AI; every beat gets a clip; stills get Ken Burns", () => {
    const clips = chooseClips(spans, {
      b1: [
        cand(ai, "ai", "octopus"),
        cand(stockA, "stock", "octopus close up"),
        cand(own, "library", "my octopus"),
      ],
      b2: [cand(ai, "ai", "gills"), cand(stockB, "stock", "octopus gills")],
      b4: [cand(ai, "ai", "octopus swimming")],
    });
    expect(clips.map((c) => [c.assetId, c.motion])).toEqual([
      ["own", "none"],
      ["stockB", "kenburns"],
      ["ai1", "kenburns"],
    ]);
  });

  it("never reuses a stock or AI asset in one Short, but may reuse the user's own", () => {
    const clips = chooseClips(spans, {
      b1: [cand(stockA, "stock", "octopus")],
      b2: [cand(stockA, "stock", "octopus"), cand(ai, "ai", "x")],
      b4: [cand(own, "library", "a"), cand(own, "library", "a")],
    });
    expect(clips.map((c) => c.assetId)).toEqual(["stockA", "ai1", "own"]);
    expect(
      chooseClips(spans, {
        b1: [cand(own, "library", "a")],
        b2: [cand(own, "library", "a")],
        b4: [cand(own, "library", "a")],
      }).map((c) => c.assetId),
    ).toEqual(["own", "own", "own"]);
  });

  it("uses an upload only on beats it matches, and spreads several uploads before repeating one", () => {
    const reef = asset("reef", "upload");
    const swim = asset("swim", "upload", "video");
    const lib = [cand(reef, "library", "octopus reef.jpg"), cand(swim, "library", "octopus swimming.mp4")];
    const clips = chooseClips(spans, {
      b1: [...lib, cand(stockA, "stock", "octopus close up")],
      b2: [...lib, cand(stockB, "stock", "octopus gills")],
      b4: [...lib, cand(ai, "ai", "octopus swimming")],
    });
    // b1 ties (first upload wins), b2 prefers the unused upload, b4 matches "swimming" best.
    expect(clips.map((c) => c.assetId)).toEqual(["reef", "swim", "swim"]);
    const unrelated = cand(asset("cat", "upload"), "library", "my cat.jpg");
    expect(
      chooseClips(spans, {
        b1: [unrelated, cand(stockA, "stock", "x")],
        b2: [unrelated],
        b4: [unrelated, cand(ai, "ai", "x")],
      }).map((c) => c.assetId),
    ).toEqual(["stockA", "cat", "ai1"]);
  });

  it("ranks by relevance within an origin", () => {
    expect(relevance("octopus gills diagram", "octopus gills")).toBeGreaterThan(
      relevance("octopus gills diagram", "beach"),
    );
  });

  it("throws when a beat has no candidate at all", () => {
    expect(() => chooseClips(spans, {})).toThrow(/no visual available/);
  });
});

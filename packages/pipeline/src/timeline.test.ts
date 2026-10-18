import { Timeline } from "@shortloop/contracts";
import { describe, expect, it } from "vitest";
import { assembleTimeline, markEmphasis, MUSIC_DUCK_DB, TAIL_MS } from "./timeline";

const input = {
  timelineId: "tl_1",
  script: { beats: [] },
  voice: {
    assetId: "aud_1",
    durationMs: 5000,
    words: [
      { text: "Octopuses", startMs: 0, endMs: 600, emphasis: false },
      { text: "have", startMs: 650, endMs: 900, emphasis: false },
      { text: "3", startMs: 950, endMs: 1200, emphasis: false },
      { text: "HEARTS.", startMs: 1250, endMs: 1800, emphasis: false },
    ],
  },
  clips: [
    { assetId: "a", startMs: 0, endMs: 2500, srcInMs: 0, fit: "cover" as const, motion: "kenburns" as const },
    { assetId: "b", startMs: 2500, endMs: 4800, srcInMs: 0, fit: "cover" as const, motion: "none" as const },
  ],
  captionStyle: "bold-pop" as const,
};

describe("assembleTimeline", () => {
  it("is valid, lasts voice + 300 ms, and stretches the last clip to the end", () => {
    const t = assembleTimeline(input);
    expect(Timeline.parse(t)).toBeTruthy();
    expect(t.durationMs).toBe(5000 + TAIL_MS);
    expect(t.video.at(-1)?.endMs).toBe(t.durationMs);
  });

  it("ducks optional music 12 dB under speech", () => {
    const t = assembleTimeline({ ...input, music: { assetId: "mus_1" } });
    expect(t.audio).toEqual([
      { assetId: "aud_1", startMs: 0, endMs: 5000, gainDb: 0 },
      { assetId: "mus_1", startMs: 0, endMs: 5300, gainDb: MUSIC_DUCK_DB },
    ]);
  });

  it("is pure: same input gives byte-identical output", () => {
    expect(JSON.stringify(assembleTimeline(input))).toBe(
      JSON.stringify(assembleTimeline(structuredClone(input))),
    );
  });

  it("emphasises numbers and ALL-CAPS words", () => {
    expect(markEmphasis(input.voice.words).map((w) => w.emphasis)).toEqual([false, false, true, true]);
  });
});

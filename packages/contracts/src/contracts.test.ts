import { describe, expect, it } from "vitest";
import {
  Asset,
  AudioClip,
  Beat,
  CaptionWord,
  Clip,
  Job,
  Licence,
  MAX_SHORT_DURATION_MS,
  PublishRequest,
  Script,
  Timeline,
} from "./index";
import { validAsset, validJob, validPublishRequest, validScript, validTimeline } from "./fixtures";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success).toBe(true);
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success).toBe(false);

describe("Licence", () => {
  it("accepts a stock licence and an attested owned licence", () => {
    ok(Licence, validAsset.licence);
    ok(Licence, { type: "owned", attestedByUserAt: "2026-10-18T12:00:00Z" });
  });
  it("rejects an unknown licence type and a malformed URL", () => {
    bad(Licence, { type: "borrowed" });
    bad(Licence, { type: "stock", licenceUrl: "not a url" });
  });
});

describe("Asset", () => {
  it("accepts a valid asset", () => ok(Asset, validAsset));
  it("rejects a disallowed source and a non-ISO createdAt", () => {
    bad(Asset, { ...validAsset, source: "youtube_download" });
    bad(Asset, { ...validAsset, createdAt: "yesterday" });
  });
});

describe("Beat and Script", () => {
  it("accepts a valid script", () => {
    ok(Script, validScript);
    ok(Beat, validScript.beats[0]);
  });
  it("rejects a script without beats, a beat without visualQuery, and a bad language tag", () => {
    bad(Script, { ...validScript, beats: [] });
    bad(Beat, { id: "b", text: "hi", estDurationMs: 100 });
    bad(Script, { ...validScript, language: "English" });
  });
});

describe("Clip, AudioClip and CaptionWord", () => {
  it("accept valid spans", () => {
    ok(Clip, validTimeline.video[0]);
    ok(AudioClip, validTimeline.audio[0]);
    ok(CaptionWord, validTimeline.captions[0]);
  });
  it("reject spans that end before they start", () => {
    bad(Clip, { ...validTimeline.video[0], startMs: 500, endMs: 100 });
    bad(AudioClip, { assetId: "a", startMs: 10, endMs: 10, gainDb: 0 });
    bad(CaptionWord, { text: "x", startMs: 5, endMs: 1, emphasis: false });
  });
});

describe("Timeline", () => {
  it("accepts a valid timeline", () => ok(Timeline, validTimeline));

  it("rejects overlapping video clips", () => {
    const res = Timeline.safeParse({
      ...validTimeline,
      video: [
        { assetId: "a", startMs: 0, endMs: 3500, srcInMs: 0, fit: "cover", motion: "none" },
        { assetId: "b", startMs: 3000, endMs: 6000, srcInMs: 0, fit: "cover", motion: "none" },
      ],
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("overlaps");
  });

  it("allows video clips that touch end-to-start, in any array order", () => {
    ok(Timeline, { ...validTimeline, video: [...validTimeline.video].reverse() });
  });

  it("rejects any track item that runs past durationMs", () => {
    bad(Timeline, { ...validTimeline, durationMs: 5000 });
    bad(Timeline, {
      ...validTimeline,
      captions: [{ text: "late", startMs: 5900, endMs: 6100, emphasis: false }],
    });
  });

  it("caps total duration at 180 000 ms", () => {
    expect(MAX_SHORT_DURATION_MS).toBe(180_000);
    ok(Timeline, { ...validTimeline, durationMs: 180_000 });
    bad(Timeline, { ...validTimeline, durationMs: 180_001 });
  });

  it("only allows 1080x1920 at 30 fps and known caption styles", () => {
    bad(Timeline, { ...validTimeline, width: 1920, height: 1080 });
    bad(Timeline, { ...validTimeline, fps: 60 });
    bad(Timeline, { ...validTimeline, captionStyle: "comic-sans" });
  });
});

describe("Job", () => {
  it("accepts a valid job", () => ok(Job, validJob));
  it("rejects progress outside 0..1, unknown status and an empty idempotency key", () => {
    bad(Job, { ...validJob, progress: 1.5 });
    bad(Job, { ...validJob, status: "paused" });
    bad(Job, { ...validJob, idempotencyKey: "" });
  });
});

describe("PublishRequest", () => {
  it("accepts a valid request", () => ok(PublishRequest, validPublishRequest));
  it("rejects a missing aiDisclosure flag, an unsupported platform and an over-long title", () => {
    const noDisclosure = Object.fromEntries(
      Object.entries(validPublishRequest).filter(([key]) => key !== "aiDisclosure"),
    );
    bad(PublishRequest, noDisclosure);
    bad(PublishRequest, { ...validPublishRequest, platform: "vimeo" });
    bad(PublishRequest, { ...validPublishRequest, title: "x".repeat(101) });
  });
});

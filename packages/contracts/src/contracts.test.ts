import { describe, expect, it } from "vitest";
import { ApiKeyInfo, ApiKeyProvider, PROVIDER_CAPABILITIES, SaveApiKey } from "./keys";
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
import {
  validAsset,
  validJob,
  validPublishRequest,
  validScript,
  validTimeline,
  validBrief,
  validNiche,
  validTopic,
  validTrendSignal,
} from "./fixtures";
import { DEFAULT_NICHES, Niche, Topic, TrendSignal } from "./trends";
import { Brief, BriefItem, FormatSlug } from "./brief";
import { FREE_MAX_CHANNELS, PLANS, maxChannelsFor } from "./billing";

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

describe("SaveApiKey / ApiKeyInfo (BYOK)", () => {
  it("accepts a known provider with a plausible key, rejects unknown providers and short keys", () => {
    expect(SaveApiKey.safeParse({ provider: "gemini", key: "AIzaSyExampleExample" }).success).toBe(true);
    expect(SaveApiKey.safeParse({ provider: "gemini", key: "short" }).success).toBe(false);
    expect(SaveApiKey.safeParse({ provider: "midjourney", key: "AIzaSyExampleExample" }).success).toBe(false);
  });
  it("info never carries a secret field", () => {
    const info = ApiKeyInfo.parse({
      provider: "openai",
      last4: "abcd",
      updatedAt: "2026-10-18T00:00:00Z",
      key: "sk-secret",
    });
    expect(info).not.toHaveProperty("key");
  });
  it("every provider has at least one capability", () => {
    for (const p of ApiKeyProvider.options) expect(PROVIDER_CAPABILITIES[p].length).toBeGreaterThan(0);
  });
});

describe("TrendSignal (E3-01)", () => {
  it("accepts a valid signal, a niche RSS signal and a global region", () => {
    ok(TrendSignal, validTrendSignal);
    ok(TrendSignal, {
      ...validTrendSignal,
      source: "rss",
      region: "global",
      categoryId: undefined,
      niche: "science",
      metric: 1,
    });
  });
  it("rejects an unknown source, a lower-case region, a non-numeric category and a bad URL", () => {
    bad(TrendSignal, { ...validTrendSignal, source: "tiktok" });
    bad(TrendSignal, { ...validTrendSignal, region: "ie" });
    bad(TrendSignal, { ...validTrendSignal, categoryId: "science" });
    bad(TrendSignal, { ...validTrendSignal, url: "not a url" });
  });
  it("rejects a negative metric, an empty title and a non-ISO observedAt", () => {
    bad(TrendSignal, { ...validTrendSignal, metric: -1 });
    bad(TrendSignal, { ...validTrendSignal, title: "" });
    bad(TrendSignal, { ...validTrendSignal, observedAt: "this morning" });
  });
});

describe("Niche and Topic (E3-02)", () => {
  it("accepts a valid niche and every default niche", () => {
    ok(Niche, validNiche);
    for (const n of DEFAULT_NICHES) ok(Niche, n);
    expect(DEFAULT_NICHES.map((n) => n.id)).toEqual(["tech", "science", "finance", "history"]);
  });
  it("rejects an upper-case id, no keywords and a non-numeric category", () => {
    bad(Niche, { ...validNiche, id: "Science" });
    bad(Niche, { ...validNiche, keywords: [] });
    bad(Niche, { ...validNiche, categoryIds: ["science"] });
  });
  it("accepts a valid topic", () => ok(Topic, validTopic));
  it("rejects labels outside 2–6 words, zero velocity, no sources and a bad source URL", () => {
    bad(Topic, { ...validTopic, label: "Fusion" });
    bad(Topic, { ...validTopic, label: "one two three four five six seven" });
    bad(Topic, { ...validTopic, velocity: 0 });
    bad(Topic, { ...validTopic, sources: [] });
    bad(Topic, { ...validTopic, sources: [{ url: "nope", title: "x", source: "rss" }] });
  });
});

describe("Brief (E3-03)", () => {
  it("accepts a full brief and a partial one", () => {
    ok(Brief, validBrief);
    ok(Brief, { ...validBrief, items: validBrief.items.slice(0, 1), partial: true });
    ok(Brief, { ...validBrief, items: [], partial: true });
  });
  it("rejects a short brief not marked partial, a partial one with 3 items, and more than 5 items", () => {
    bad(Brief, { ...validBrief, items: validBrief.items.slice(0, 2) });
    bad(Brief, { ...validBrief, partial: true });
    const item = validBrief.items[0];
    bad(Brief, { ...validBrief, items: [item, item, item, item, item, item] });
  });
  it("rejects an item without sources, an unknown format, a long hook and a bad date", () => {
    const item = validBrief.items[0];
    ok(BriefItem, item);
    bad(BriefItem, { ...item, sources: [] });
    bad(BriefItem, { ...item, format: "listicle" });
    bad(BriefItem, {
      ...item,
      hook: "one two three four five six seven eight nine ten eleven twelve thirteen",
    });
    bad(Brief, { ...validBrief, date: "20 Oct" });
  });
  it("uses the playbook slugs", () => {
    expect(FormatSlug.options).toEqual(["trend-explainer", "myth-vs-fact", "top-3-list", "news-in-60s"]);
  });
});

describe("channel limits per plan (E1-04)", () => {
  it("Free and Creator allow one channel, Pro three", () => {
    expect(FREE_MAX_CHANNELS).toBe(1);
    expect(maxChannelsFor(null)).toBe(1);
    expect(maxChannelsFor("creator")).toBe(PLANS.creator.maxChannels);
    expect(maxChannelsFor("creator")).toBe(1);
    expect(maxChannelsFor("pro")).toBe(3);
  });
  it("beta (credit-exempt) users get at least Pro's allowance; admins have no limit", () => {
    expect(maxChannelsFor(null, { unlimited: true })).toBe(3);
    expect(maxChannelsFor("creator", { unlimited: true })).toBe(3);
    expect(maxChannelsFor(null, { admin: true, unlimited: true })).toBe(Number.POSITIVE_INFINITY);
  });
});

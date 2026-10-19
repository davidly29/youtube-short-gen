import { readFile } from "node:fs/promises";
import { TrendSignal } from "@shortloop/contracts";
import { describe, expect, it, vi } from "vitest";
import { extractKeywords, trendSignalId } from "./collector";
import { trendCollectorsFromEnv } from "./index";
import { WikipediaPageviewsCollector } from "./wikipedia";
import {
  QuotaBudgetError,
  YOUTUBE_TRENDS_DAILY_QUOTA,
  YouTubePopularCollector,
  youtubeDailyQuota,
} from "./youtube-popular";

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-19T09:20:00Z");

/** The only URL prefixes the metadata collectors may ever request (E3-01 acceptance). */
const ALLOWLIST = [
  "https://www.googleapis.com/youtube/v3/videos?",
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/",
];

/** A fake `fetch` that serves fixtures and fails the test on any URL outside the allowlist. */
function allowlistedFetch(routes: Record<string, () => Promise<Response>>) {
  const requested: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (!ALLOWLIST.some((p) => url.startsWith(p))) throw new Error(`blocked non-allowlisted fetch: ${url}`);
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return respond();
    return new Response("not found", { status: 404 });
  });
  return { fetch: impl as unknown as typeof fetch, requested };
}

const json = async (name: string) =>
  new Response(await fixture(name), { status: 200, headers: { "content-type": "application/json" } });

describe("YouTube most-popular collector (E3-01)", () => {
  const routes = {
    "videoCategoryId=28": () => json("youtube-videos-IE-28.json"),
    "videoCategoryId=27": () => json("youtube-videos-IE-27.json"),
  };

  it("recorded responses produce schema-valid signals with keywords from titles and tags", async () => {
    const { fetch } = allowlistedFetch(routes);
    const yt = new YouTubePopularCollector({ apiKey: "fake-key", fetch, now: () => NOW });
    const signals = await yt.collect("IE", ["27", "28"]);
    expect(signals).toHaveLength(4); // the untitled video is dropped
    for (const s of signals) TrendSignal.parse(s);
    const battery = signals.find((s) => s.title.startsWith("Why Solid-State"));
    expect(battery).toMatchObject({
      source: "youtube_popular",
      region: "IE",
      categoryId: "28",
      metric: 912004,
      url: "https://www.youtube.com/watch?v=fx_tech_002",
      observedAt: NOW.toISOString(),
    });
    expect(battery?.keywords).toEqual(
      expect.arrayContaining(["solid-state", "batteries", "finally", "solid-state battery", "battery tech"]),
    );
  });

  it("only calls videos.list with chart=mostPopular and never fetches thumbnails or videos", async () => {
    const { fetch, requested } = allowlistedFetch(routes);
    await new YouTubePopularCollector({ apiKey: "fake-key", fetch, now: () => NOW }).collect("IE", [
      "27",
      "28",
    ]);
    expect(requested).toHaveLength(2);
    for (const url of requested) {
      const u = new URL(url);
      expect(`${u.origin}${u.pathname}`).toBe("https://www.googleapis.com/youtube/v3/videos");
      expect(u.searchParams.get("chart")).toBe("mostPopular");
      expect(u.searchParams.get("part")).toBe("snippet,statistics");
      expect(u.searchParams.get("regionCode")).toBe("IE");
    }
    expect(requested.some((u) => u.includes("ytimg.com") || u.includes("watch?v="))).toBe(false);
  });

  it("the default config (1 region, categories 27 and 28, hourly) stays within 500 units/day", () => {
    expect(youtubeDailyQuota(2)).toBe(48);
    expect(youtubeDailyQuota(2)).toBeLessThanOrEqual(YOUTUBE_TRENDS_DAILY_QUOTA);
  });

  it("refuses a config that would exceed the daily quota, before calling the API", async () => {
    const { fetch, requested } = allowlistedFetch(routes);
    const yt = new YouTubePopularCollector({ apiKey: "k", fetch });
    const tooMany = Array.from({ length: 21 }, (_, i) => String(i + 1)); // 21 × 24 = 504 units
    await expect(yt.collect("IE", tooMany)).rejects.toBeInstanceOf(QuotaBudgetError);
    expect(() => yt.assertWithinQuota(20)).not.toThrow(); // 480 units
    expect(requested).toHaveLength(0);
  });

  it("skips a category that has no chart in the region instead of failing the run", async () => {
    const { fetch } = allowlistedFetch({ "videoCategoryId=28": () => json("youtube-videos-IE-28.json") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const signals = await new YouTubePopularCollector({ apiKey: "k", fetch, now: () => NOW }).collect("IE", [
      "99",
      "28",
    ]);
    expect(signals).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Wikipedia pageviews collector (E3-01)", () => {
  it("recorded top-per-country response produces schema-valid topic signals for yesterday", async () => {
    const { fetch, requested } = allowlistedFetch({
      "/top-per-country/IE/all-access/2026/10/18": () => json("wikipedia-top-per-country-IE.json"),
    });
    const wiki = new WikipediaPageviewsCollector({ fetch, now: () => NOW });
    const signals = await wiki.collect("IE");
    for (const s of signals) TrendSignal.parse(s);
    expect(signals.map((s) => s.title)).toEqual([
      "Halley's Comet",
      "Solid-state battery",
      "Hurricane Nadia (2026)",
      "Éire",
    ]); // main page, Special:/Wikipedia: pages and non-Wikipedia projects are dropped
    expect(signals[0]).toMatchObject({
      source: "wikipedia",
      region: "IE",
      metric: 23400,
      observedAt: "2026-10-18T00:00:00.000Z",
      url: "https://en.wikipedia.org/wiki/Halley's_Comet",
    });
    expect(signals[0]?.categoryId).toBeUndefined();
    expect(requested).toEqual([
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/IE/all-access/2026/10/18",
    ]);
  });

  it("sends a descriptive User-Agent and falls back a day when yesterday isn't published yet", async () => {
    const { fetch, requested } = allowlistedFetch({
      "/2026/10/17": () => json("wikipedia-top-per-country-IE.json"),
    });
    const signals = await new WikipediaPageviewsCollector({ fetch, now: () => NOW }).collect("IE");
    expect(requested).toHaveLength(2);
    expect(signals[0]?.observedAt).toBe("2026-10-17T00:00:00.000Z");
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/ShortLoop.*github\.com/);
  });
});

describe("helpers", () => {
  it("signal ids are stable within an hour and differ across hours", () => {
    const a = { source: "wikipedia", region: "IE", title: "X", observedAt: "2026-10-19T09:01:00Z" } as const;
    expect(trendSignalId(a)).toBe(trendSignalId({ ...a, observedAt: "2026-10-19T09:59:00Z" }));
    expect(trendSignalId(a)).not.toBe(trendSignalId({ ...a, observedAt: "2026-10-19T10:00:00Z" }));
  });

  it("extractKeywords drops stopwords, numbers and duplicates, and keeps whole tags", () => {
    expect(extractKeywords("Why The Fusion Reactor Is Fusion 2026", ["nuclear fusion"])).toEqual([
      "fusion",
      "reactor",
      "nuclear fusion",
    ]);
  });

  it("without YOUTUBE_API_KEY the YouTube collector is skipped with a warning; Wikipedia remains", () => {
    const warn = vi.fn();
    const sources = trendCollectorsFromEnv({}, fetch, warn).map((c) => c.source);
    expect(sources).toEqual(["wikipedia"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/YOUTUBE_API_KEY/));
    expect(trendCollectorsFromEnv({ YOUTUBE_API_KEY: "k" }, fetch, warn).map((c) => c.source)).toEqual([
      "youtube_popular",
      "wikipedia",
    ]);
  });
});

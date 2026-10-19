import { readFile } from "node:fs/promises";
import { TrendSignal } from "@shortloop/contracts";
import { describe, expect, it, vi } from "vitest";
import feeds from "./feeds.json";
import { type FeedConfig, parseFeed, RssCollector } from "./rss";

const fixture = (name: string) => readFile(new URL(`./fixtures/rss/${name}`, import.meta.url), "utf8");
const NOW = new Date("2026-10-19T09:20:00Z");

const FEEDS: FeedConfig[] = [
  {
    niche: "tech",
    name: "Fixture Tech",
    feedUrl: "https://tech.example.com/feed.xml",
    homepageUrl: "https://tech.example.com/",
  },
  {
    niche: "science",
    name: "Fixture Science",
    feedUrl: "https://science.example.org/atom.xml",
    homepageUrl: "https://science.example.org/",
  },
];

/** Serves the fixture feeds and records every requested URL. */
function feedFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  const requested: string[] = [];
  const routes: Record<string, () => Promise<Response>> = {
    "https://tech.example.com/feed.xml": async () => new Response(await fixture("tech-rss2.xml")),
    "https://science.example.org/atom.xml": async () => new Response(await fixture("science-atom.xml")),
    ...overrides,
  };
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  });
  return { fetch: impl as unknown as typeof fetch, requested };
}

describe("RSS collector (E3-01c)", () => {
  it("RSS 2.0 and Atom fixture feeds parse to schema-valid signals, dropping items older than 48 h", async () => {
    const { fetch } = feedFetch();
    const signals = await new RssCollector({ feeds: FEEDS, fetch, now: () => NOW }).collect("global");
    for (const s of signals) TrendSignal.parse(s);
    expect(signals.map((s) => s.title).sort()).toEqual([
      "Astronomers spot water vapour on a temperate exoplanet",
      "Chipmaker unveils 1nm prototype & roadmap",
      "Deep-sea microbes eat plastic, study finds",
      "Open-source AI model tops coding benchmark",
    ]); // the week-old item, the undated item and the archive entry are dropped
    const chip = signals.find((s) => s.title.startsWith("Chipmaker"));
    expect(chip).toMatchObject({
      source: "rss",
      region: "global",
      niche: "tech",
      metric: 1,
      url: "https://tech.example.com/2026/10/19/1nm-prototype",
      observedAt: "2026-10-19T08:30:00.000Z",
    });
    expect(chip?.keywords).toEqual(expect.arrayContaining(["chipmaker", "prototype", "semiconductors"]));
    const planet = signals.find((s) => s.title.startsWith("Astronomers"));
    expect(planet).toMatchObject({
      niche: "science",
      url: "https://science.example.org/news/exoplanet-water", // the alternate link, not the enclosure
    });
    expect(planet?.keywords).toEqual(expect.arrayContaining(["astronomy", "exoplanets"]));
  });

  it("only the configured feed URLs are fetched (enclosures, media and article links never are)", async () => {
    const { fetch, requested } = feedFetch();
    await new RssCollector({ feeds: FEEDS, fetch, now: () => NOW }).collect("global");
    expect(requested.sort()).toEqual(FEEDS.map((f) => f.feedUrl).sort());
    // The fixtures contain enclosure/media URLs; none of them were requested.
    const xml = (await fixture("tech-rss2.xml")) + (await fixture("science-atom.xml"));
    expect(xml).toContain("https://cdn.tech.example.com/media/1nm.mp4");
    expect(requested.some((u) => u.includes("cdn."))).toBe(false);
  });

  it("a feed that errors or times out is skipped and the other feeds still produce signals", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
      });
    const base = feedFetch();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      String(input) === "https://science.example.org/atom.xml" ? hang(input, init) : base.fetch(input, init),
    ) as unknown as typeof fetch;
    const broken: FeedConfig = {
      niche: "tech",
      name: "Broken",
      feedUrl: "https://broken.example.net/rss",
      homepageUrl: "https://broken.example.net/",
    };
    const signals = await new RssCollector({
      feeds: [...FEEDS, broken],
      fetch: fetchImpl,
      now: () => NOW,
      timeoutMs: 50,
    }).collect("global");
    expect(signals.map((s) => s.niche)).toEqual(["tech", "tech"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Fixture Science/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Broken.*404/));
    warn.mockRestore();
  });

  it("garbage that isn't a feed is rejected", () => {
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow(/not an RSS 2.0 or Atom feed/);
  });
});

describe("feeds.json (E3-01c)", () => {
  it("every entry has a niche, a name, an https feed URL and a homepage URL", () => {
    expect(feeds.length).toBeGreaterThan(0);
    for (const f of feeds) {
      expect(f.niche, f.name).toMatch(/^[a-z]+$/);
      expect(f.name.length, f.feedUrl).toBeGreaterThan(0);
      expect(new URL(f.feedUrl).protocol).toBe("https:");
      expect(new URL(f.homepageUrl).protocol).toBe("https:");
    }
  });

  it("covers each default niche with 2–3 feeds", () => {
    const perNiche = new Map<string, number>();
    for (const f of feeds) perNiche.set(f.niche, (perNiche.get(f.niche) ?? 0) + 1);
    for (const niche of ["tech", "science", "finance", "history"]) {
      expect(perNiche.get(niche), niche).toBeGreaterThanOrEqual(2);
      expect(perNiche.get(niche), niche).toBeLessThanOrEqual(3);
    }
  });
});

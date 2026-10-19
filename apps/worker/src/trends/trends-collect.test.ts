import { readFile } from "node:fs/promises";
import { TrendSignal } from "@shortloop/contracts";
import {
  eq,
  insertSignals,
  openDb,
  schema,
  seed,
  toTrendSignal,
  TRENDS_OWNER_ID,
  type DbHandle,
} from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import {
  FakeTrendCollector,
  LocalStorage,
  RssCollector,
  trendCollectorsFromEnv,
  WikipediaPageviewsCollector,
  YouTubePopularCollector,
  type TrendCollector,
} from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../worker";
import { DEFAULT_TRENDS_CONFIG, scheduleTrends, trendsConfigFromEnv } from "./schedule";

const NOW = new Date("2026-10-19T09:20:00Z");
const fixtures = new URL("../../../../packages/providers/src/trends/fixtures/", import.meta.url);
const fixture = (name: string) => readFile(new URL(name, fixtures), "utf8");

/** URL prefixes the trend stage may request: the two metadata APIs and the configured feed URLs. */
const ALLOWLIST = [
  "https://www.googleapis.com/youtube/v3/videos?",
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/",
  "https://tech.example.com/feed.xml",
];

function fixtureFetch() {
  const requested: string[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (!ALLOWLIST.some((p) => url.startsWith(p))) throw new Error(`blocked non-allowlisted fetch: ${url}`);
    if (url.includes("videoCategoryId=28")) return new Response(await fixture("youtube-videos-IE-28.json"));
    if (url.includes("videoCategoryId=27")) return new Response(await fixture("youtube-videos-IE-27.json"));
    if (url.includes("/top-per-country/"))
      return new Response(await fixture("wikipedia-top-per-country-IE.json"));
    if (url.endsWith("feed.xml")) return new Response(await fixture("rss/tech-rss2.xml"));
    return new Response("not found", { status: 404 });
  };
  return { fetch: impl as typeof fetch, requested };
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}

let h: DbHandle;
let driver: MemoryQueueDriver;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  driver = new MemoryQueueDriver();
});
afterEach(async () => {
  await driver.close();
  await h.close();
});

const worker = (trendCollectors: TrendCollector[]): JobService =>
  createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage: new LocalStorage("/tmp/shortloop-trends-unused"),
    trendCollectors,
  });

const storedSignals = async () => (await h.db.select().from(schema.trendSignals)).map(toTrendSignal);

describe("trends stage (E3-01)", () => {
  it("schedules one job per region plus one global job, idempotent per hour, owned by the system user, free", async () => {
    const jobs = worker([]);
    const first = await scheduleTrends(jobs, h.db, DEFAULT_TRENDS_CONFIG, NOW);
    const again = await scheduleTrends(jobs, h.db, DEFAULT_TRENDS_CONFIG, new Date("2026-10-19T09:55:00Z"));
    expect(first.map((j) => j.idempotencyKey)).toEqual([
      "trends:IE:2026-10-19T09:00:00.000Z",
      "trends:GB:2026-10-19T09:00:00.000Z",
      "trends:US:2026-10-19T09:00:00.000Z",
      "trends:global:2026-10-19T09:00:00.000Z",
    ]);
    expect(again.map((j) => j.id)).toEqual(first.map((j) => j.id));
    expect(first.every((j) => j.costCredits === 0 && j.type === "trends")).toBe(true);
    const rows = await h.db.select().from(schema.jobs).where(eq(schema.jobs.type, "trends"));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(new Set([TRENDS_OWNER_ID]));
    const next = await scheduleTrends(jobs, h.db, DEFAULT_TRENDS_CONFIG, new Date("2026-10-19T10:01:00Z"));
    expect(next[0]?.id).not.toBe(first[0]?.id);
  });

  it("runs the real collectors on recorded responses: schema-valid signals stored, only allowlisted URLs fetched", async () => {
    const { fetch, requested } = fixtureFetch();
    const feeds = [
      {
        niche: "tech",
        name: "Fixture Tech",
        feedUrl: "https://tech.example.com/feed.xml",
        homepageUrl: "https://tech.example.com/",
      },
    ];
    const jobs = worker([
      new YouTubePopularCollector({ apiKey: "fake-key", fetch, now: () => NOW }),
      new WikipediaPageviewsCollector({ fetch, now: () => NOW }),
      new RssCollector({ feeds, fetch, now: () => NOW }),
    ]);
    const queued = await scheduleTrends(jobs, h.db, { regions: ["IE"], categoryIds: ["27", "28"] }, NOW);
    await driver.drain();
    for (const j of queued) expect((await jobs.get(j.id))?.status).toBe("succeeded");

    const signals = await storedSignals();
    for (const s of signals) TrendSignal.parse(s);
    const count = (source: string) => signals.filter((s) => s.source === source).length;
    expect(count("youtube_popular")).toBe(4);
    expect(count("wikipedia")).toBe(4);
    expect(count("rss")).toBe(2);
    expect(signals.find((s) => s.source === "rss")?.region).toBe("global");

    // Metadata only: thumbnails, videos, enclosures and article links were never requested.
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested)
      expect(
        ALLOWLIST.some((p) => url.startsWith(p)),
        url,
      ).toBe(true);
    expect(requested.some((u) => /ytimg|\.mp4|\.mp3|\.jpg|watch\?v=|cdn\./.test(u))).toBe(false);

    const out = (await jobs.get(must(queued[0]).id))?.output;
    expect(out).toMatchObject({ region: "IE", inserted: 8, bySource: { youtube_popular: 4, wikipedia: 4 } });
  });

  it("re-running the same hour stores nothing new", async () => {
    const collectors = [new FakeTrendCollector("youtube_popular", "region", { now: () => NOW })];
    const jobs = worker(collectors);
    const [a] = await scheduleTrends(jobs, h.db, { regions: ["IE"], categoryIds: ["28"] }, NOW);
    await driver.drain();
    expect((await jobs.get(must(a).id))?.output).toMatchObject({ inserted: 2 });
    // A second job for the same hour (e.g. a manual re-run) inserts nothing.
    const b = await jobs.enqueue(
      "trends",
      { region: "IE", categoryIds: ["28"], hour: "x" },
      { idempotencyKey: "manual-rerun", ownerId: TRENDS_OWNER_ID },
    );
    await driver.drain();
    expect((await jobs.get(b.id))?.output).toMatchObject({ collected: 2, inserted: 0 });
    expect(await storedSignals()).toHaveLength(2);
  });

  it("without YOUTUBE_API_KEY the YouTube collector is skipped with a warning and Wikipedia still runs", async () => {
    const { fetch, requested } = fixtureFetch();
    const warn = vi.fn();
    const collectors = trendCollectorsFromEnv({}, fetch, warn);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/YOUTUBE_API_KEY/));
    const jobs = worker(collectors);
    const [ie] = await scheduleTrends(jobs, h.db, { regions: ["IE"], categoryIds: ["28"] }, new Date());
    await driver.drain();
    expect((await jobs.get(must(ie).id))?.status).toBe("succeeded");
    const signals = await storedSignals();
    expect(signals.some((s) => s.source === "wikipedia")).toBe(true);
    expect(signals.some((s) => s.source === "youtube_popular")).toBe(false);
    expect(requested.some((u) => u.includes("googleapis.com"))).toBe(false);
  });

  it("one failing collector doesn't lose the others' signals; all failing fails the job without charging anyone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const jobs = worker([
      new FakeTrendCollector("youtube_popular", "region", { fail: true }),
      new FakeTrendCollector("wikipedia", "region", { now: () => NOW }),
    ]);
    const [ok] = await scheduleTrends(jobs, h.db, { regions: ["IE"], categoryIds: ["28"] }, NOW);
    await driver.drain();
    const done = await jobs.get(must(ok).id);
    expect(done?.status).toBe("succeeded");
    expect(done?.output).toMatchObject({ inserted: 2, errors: { youtube_popular: expect.any(String) } });

    const allFail = worker([new FakeTrendCollector("wikipedia", "region", { fail: true })]);
    const bad = await allFail.enqueue(
      "trends",
      { region: "GB", categoryIds: [], hour: "h" },
      { idempotencyKey: "all-fail", ownerId: TRENDS_OWNER_ID },
    );
    await driver.drain();
    expect((await allFail.get(bad.id))?.status).toBe("failed");
    const ledger = await h.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.ownerId, TRENDS_OWNER_ID));
    expect(ledger).toEqual([]);
    warn.mockRestore();
  });

  it("each run prunes signals older than 30 days", async () => {
    await insertSignals(h.db, [
      {
        id: "sig_old",
        source: "wikipedia",
        region: "IE",
        title: "Old news",
        keywords: ["old"],
        metric: 1,
        observedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      },
    ]);
    const jobs = worker([new FakeTrendCollector("wikipedia", "region")]);
    const [j] = await scheduleTrends(jobs, h.db, { regions: ["IE"], categoryIds: [] }, new Date());
    await driver.drain();
    expect((await jobs.get(must(j).id))?.output).toMatchObject({ pruned: 1 });
    expect((await storedSignals()).some((s) => s.id === "sig_old")).toBe(false);
  });
});

describe("trendsConfigFromEnv", () => {
  it("defaults to IE,GB,US and categories 27,28", () => {
    expect(trendsConfigFromEnv({})).toEqual({ regions: ["IE", "GB", "US"], categoryIds: ["27", "28"] });
    expect(trendsConfigFromEnv({ TRENDS_REGIONS: "de, fr", TRENDS_CATEGORIES: "28" })).toEqual({
      regions: ["DE", "FR"],
      categoryIds: ["28"],
    });
  });
  it("rejects malformed values and a category list over the YouTube quota budget", () => {
    expect(() => trendsConfigFromEnv({ TRENDS_REGIONS: "Ireland" })).toThrow(/two-letter/);
    expect(() => trendsConfigFromEnv({ TRENDS_CATEGORIES: "science" })).toThrow(/numeric/);
    const many = Array.from({ length: 21 }, (_, i) => String(i + 1)).join(",");
    expect(() => trendsConfigFromEnv({ TRENDS_CATEGORIES: many })).toThrow(/504 YouTube quota units/);
  });
});

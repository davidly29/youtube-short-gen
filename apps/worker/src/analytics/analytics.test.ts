import type { PublishRequest } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver } from "@shortloop/pipeline";
import { FakeYouTube, FakeYouTubeAnalytics, LocalStorage, SecretBox } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectYouTubeChannel } from "../channels";
import { createWorker } from "../worker";
import {
  ANALYTICS_BACKFILL_DAYS,
  analyticsHandler,
  channelsMissingAnalytics,
  metricsWindow,
  refreshAnalytics,
  scheduleAnalytics,
  shortPerformance,
} from ".";

let h: DbHandle;
let yt: FakeYouTube;
let fake: FakeYouTubeAnalytics;
let ch: string;
const box = new SecretBox("analytics-test-master-key-123456");
const NOW = new Date("2026-10-23T09:00:00Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * DAY_MS).toISOString();

const request = (title: string): PublishRequest => ({
  platform: "youtube",
  accountId: "acct",
  videoAssetId: SEED.assetIds[0],
  title,
  description: "d",
  tags: [],
  privacy: "public",
  aiDisclosure: true,
});

async function publish(id: string, opts: { daysAgo: number; status?: "published" | "scheduled" | "failed" }) {
  await h.db.insert(schema.publishRecords).values({
    id,
    ownerId: SEED.userId,
    platform: "youtube",
    channelId: ch,
    videoAssetId: SEED.assetIds[0],
    request: request(`Short ${id}`),
    status: opts.status ?? "published",
    externalId: `vid_${id}`,
    url: `https://www.youtube.com/shorts/vid_${id}`,
    publishedAt: daysAgo(opts.daysAgo),
    idempotencyKey: `publish:${id}`,
  });
}

const run = (now = NOW) =>
  analyticsHandler({ db: h.db, box, youtube: yt, analytics: fake, now: () => now })({
    job: {
      id: "job_a",
      type: "analytics",
      status: "running",
      progress: 0,
      input: { channelId: ch, reason: "daily" },
      costCredits: 0,
      idempotencyKey: "k",
    },
    ownerId: SEED.userId,
    onProgress: async () => undefined,
  });

const metricRows = (publishId: string) =>
  h.db.select().from(schema.shortMetrics).where(eq(schema.shortMetrics.publishId, publishId));

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  yt = new FakeYouTube();
  fake = new FakeYouTubeAnalytics();
  ch = await connectYouTubeChannel(h.db, box, yt, SEED.userId, "fake-code-1");
});
afterEach(() => h.close());

describe("metricsWindow", () => {
  it("backfills 28 days first, from the publish day if later, then refreshes the last 3 days or fills a gap", () => {
    expect(metricsWindow(daysAgo(60), undefined, "2026-10-23")).toEqual({
      startDate: "2026-09-26",
      endDate: "2026-10-23",
    });
    expect(metricsWindow("2026-10-20T15:00:00Z", undefined, "2026-10-23")).toEqual({
      startDate: "2026-10-20",
      endDate: "2026-10-23",
    });
    expect(metricsWindow(daysAgo(60), "2026-10-22", "2026-10-23")?.startDate).toBe("2026-10-21");
    expect(metricsWindow(daysAgo(60), "2026-10-10", "2026-10-23")?.startDate).toBe("2026-10-11");
    expect(metricsWindow("2026-10-24T01:00:00Z", undefined, "2026-10-23")).toBeUndefined();
  });
});

describe("performance ingest (E10-01)", () => {
  it("backfills 28 days on first connect, and daily upserts are idempotent", async () => {
    await publish("pub_old", { daysAgo: 60 });
    await publish("pub_new", { daysAgo: 5 });

    const first = await run();
    expect(first).toMatchObject({ shorts: 2, backfilled: 2 });
    expect(await metricRows("pub_old")).toHaveLength(ANALYTICS_BACKFILL_DAYS);
    expect(await metricRows("pub_new")).toHaveLength(6); // publish day .. today
    expect(fake.calls.map((c) => c.startDate).sort()).toEqual(["2026-09-26", "2026-10-18"]);

    // Same day again: same rows, same numbers (upsert, not insert).
    const before = await h.db.select().from(schema.shortMetrics);
    await run();
    const after = await h.db.select().from(schema.shortMetrics);
    expect(after).toHaveLength(before.length);
    const strip = (rows: typeof after) =>
      rows
        .map((r) => ({ ...r, updatedAt: "" }))
        .sort((a, b) => `${a.publishId}${a.date}`.localeCompare(`${b.publishId}${b.date}`));
    expect(strip(after)).toEqual(strip(before));

    // Next day: re-reads only the last 3 days, adds one new day, and revised numbers replace old ones.
    fake.calls.length = 0;
    fake.overrides.set("vid_pub_new", { views: 9999 });
    const tomorrow = new Date(NOW.getTime() + DAY_MS);
    await run(tomorrow);
    expect(fake.calls.map((c) => c.startDate)).toEqual(["2026-10-22", "2026-10-22"]);
    expect(await metricRows("pub_old")).toHaveLength(ANALYTICS_BACKFILL_DAYS + 1);
    const revised = (await metricRows("pub_new")).filter((r) => r.date >= "2026-10-22");
    expect(revised.map((r) => r.views)).toEqual([9999, 9999, 9999]);
  });

  it("skips Shorts that aren't live: failed, or scheduled for later", async () => {
    await publish("pub_failed", { daysAgo: 2, status: "failed" });
    await publish("pub_later", { daysAgo: -2, status: "scheduled" });
    await publish("pub_sched_live", { daysAgo: 1, status: "scheduled" });
    const out = await run();
    expect(out).toMatchObject({ shorts: 1 });
    expect(fake.calls.map((c) => c.videoId)).toEqual(["vid_pub_sched_live"]);
  });

  it("a channel connected before analytics is skipped (not failed) and listed for reconnect", async () => {
    await publish("pub_1", { daysAgo: 3 });
    await h.db
      .update(schema.channels)
      .set({ scopes: "https://www.googleapis.com/auth/youtube.upload" })
      .where(eq(schema.channels.id, ch));
    const out = await run();
    expect(out.skipped).toMatch(/reconnect/);
    expect(fake.calls).toHaveLength(0);
    expect(await channelsMissingAnalytics(h.db, SEED.userId)).toEqual([{ id: ch, title: "Fake Channel" }]);
    // The feature row is still written (E10-02).
    expect(out.features).toBe(1);
  });

  it("Google refusing the analytics scope mid-run (grant changed at Google) skips without rows", async () => {
    await publish("pub_1", { daysAgo: 3 });
    fake.noScope = true;
    expect((await run()).skipped).toMatch(/reconnect/);
    expect(await h.db.select().from(schema.shortMetrics)).toHaveLength(0);
  });

  it("the dashboard card totals views and weights retention by views", async () => {
    await publish("pub_a", { daysAgo: 1 });
    await publish("pub_b", { daysAgo: 1 });
    fake.overrides.set("vid_pub_a", { views: 1000, avgViewPct: 90, likes: 10 });
    fake.overrides.set("vid_pub_b", { views: 100, avgViewPct: 50, likes: 1 });
    await run();
    // Make pub_a's two days uneven so the weighting shows: 1000 @ 90% + 3000 @ 70%.
    await h.db
      .update(schema.shortMetrics)
      .set({ views: 3000, avgViewPct: 70 })
      .where(eq(schema.shortMetrics.date, "2026-10-23"));
    const cards = await shortPerformance(h.db, SEED.userId);
    expect(cards.map((c) => c.publishId)).toEqual(["pub_a", "pub_b"]);
    expect(cards[0]).toMatchObject({ days: 2, views: 4000, avgViewPct: 75, likes: 20, title: "Short pub_a" });
    expect(cards[1]).toMatchObject({ views: 3100 });
    expect(await shortPerformance(h.db, "usr_nobody")).toEqual([]);
  });
});

describe("scheduling", () => {
  it("one ingest per connected channel per day; Refresh at most once an hour; runs on the analytics queue", async () => {
    await publish("pub_1", { daysAgo: 2 });
    const driver = new MemoryQueueDriver();
    const storage = new LocalStorage("/tmp/unused-analytics-store");
    const jobs = createWorker({
      db: h.db,
      driver,
      bus: new MemoryEventBus(),
      storage,
      box,
      youtube: yt,
      youtubeAnalytics: fake,
      now: () => NOW,
    });
    const a = await scheduleAnalytics(jobs, h.db, NOW);
    const b = await scheduleAnalytics(jobs, h.db, new Date(NOW.getTime() + 3_600_000));
    expect(a).toHaveLength(1);
    expect(b[0]?.id).toBe(a[0]?.id);
    expect(a[0]).toMatchObject({ type: "analytics", costCredits: 0 });
    const r1 = await refreshAnalytics(jobs, h.db, SEED.userId, NOW);
    const r2 = await refreshAnalytics(jobs, h.db, SEED.userId, new Date(NOW.getTime() + 60_000));
    expect(r2[0]?.id).toBe(r1[0]?.id);
    expect(await refreshAnalytics(jobs, h.db, "usr_nobody", NOW)).toEqual([]);
    await driver.drain();
    const done = await h.db.select().from(schema.jobs).where(eq(schema.jobs.type, "analytics"));
    expect(done.map((j) => j.status)).toEqual(["succeeded", "succeeded"]);
    expect(await metricRows("pub_1")).toHaveLength(3);
  });
});

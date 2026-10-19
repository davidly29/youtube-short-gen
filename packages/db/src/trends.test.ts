import { TrendSignal } from "@shortloop/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "./client";
import { trendSignals } from "./schema";
import {
  ensureTrendsOwner,
  hourBucket,
  insertSignals,
  pruneSignals,
  toTrendSignal,
  TRENDS_OWNER_ID,
} from "./trends";

let h: DbHandle;
beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
});
afterEach(async () => {
  await h.close();
});

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const signal = (over: Partial<TrendSignal> = {}): TrendSignal => ({
  id: `sig_${Math.random().toString(36).slice(2)}`,
  source: "youtube_popular",
  region: "IE",
  categoryId: "28",
  title: "Fusion breakthrough explained",
  url: "https://www.youtube.com/watch?v=abc",
  keywords: ["fusion", "breakthrough"],
  metric: 120_000,
  observedAt: "2026-10-19T09:12:00Z",
  ...over,
});

describe("trend_signals (E3-01)", () => {
  it("insertSignals twice inserts once (same id, or same source/region/category/title in the same hour)", async () => {
    const a = signal({ id: "sig_a" });
    expect(await insertSignals(h.db, [a])).toBe(1);
    expect(await insertSignals(h.db, [a])).toBe(0);
    // A later collection in the same hour produces a fresh id but the same dedupe key.
    expect(await insertSignals(h.db, [{ ...a, id: "sig_b", observedAt: "2026-10-19T09:48:00Z" }])).toBe(0);
    // The next hour is a new observation.
    expect(await insertSignals(h.db, [{ ...a, id: "sig_c", observedAt: "2026-10-19T10:05:00Z" }])).toBe(1);
    expect(await h.db.select().from(trendSignals)).toHaveLength(2);
  });

  it("round-trips rows back to schema-valid signals, with and without a category", async () => {
    await insertSignals(h.db, [
      signal({ id: "sig_yt" }),
      signal({
        id: "sig_wiki",
        source: "wikipedia",
        categoryId: undefined,
        title: "Halley's Comet",
        url: "https://en.wikipedia.org/wiki/Halley%27s_Comet",
      }),
      signal({ id: "sig_rss", source: "rss", region: "global", categoryId: undefined, niche: "science" }),
    ]);
    const rows = await h.db.select().from(trendSignals);
    for (const r of rows) TrendSignal.parse(toTrendSignal(r));
    const byId = (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`missing ${id}`);
      return toTrendSignal(row);
    };
    const wiki = byId("sig_wiki");
    expect(wiki.categoryId).toBeUndefined();
    expect(wiki.observedAt).toBe("2026-10-19T09:12:00.000Z");
    expect(byId("sig_rss").niche).toBe("science");
  });

  it("pruneSignals deletes only rows older than 30 days", async () => {
    await insertSignals(h.db, [
      signal({ id: "old", observedAt: daysAgo(31) }),
      signal({ id: "edge_old", observedAt: daysAgo(30.01), title: "b" }),
      signal({ id: "edge_new", observedAt: daysAgo(29.99), title: "c" }),
      signal({ id: "new", observedAt: daysAgo(1), title: "d" }),
    ]);
    expect(await pruneSignals(h.db, NOW)).toBe(2);
    const left = (await h.db.select({ id: trendSignals.id }).from(trendSignals)).map((r) => r.id).sort();
    expect(left).toEqual(["edge_new", "new"]);
    expect(await pruneSignals(h.db, NOW, 2)).toBe(1);
  });

  it("hourBucket truncates to the hour in UTC", () => {
    expect(hourBucket("2026-10-19T09:59:59.999+01:00")).toBe("2026-10-19T08:00:00.000Z");
  });

  it("ensureTrendsOwner creates the system owner once", async () => {
    expect(await ensureTrendsOwner(h.db)).toBe(TRENDS_OWNER_ID);
    await ensureTrendsOwner(h.db);
    const owner = await h.db.query.users.findFirst();
    expect(owner).toMatchObject({ id: TRENDS_OWNER_ID, role: "system", creditExempt: true });
  });
});

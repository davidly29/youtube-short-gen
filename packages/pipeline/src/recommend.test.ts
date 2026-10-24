import { Recommendation, type HookType, type PublishRequest, type ShortFeatures } from "@shortloop/contracts";
import { openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyOverride,
  ARMS,
  armPosteriors,
  normal,
  recommend,
  recommendFromRows,
  replay,
  seededRng,
  type Arm,
  type ArmFormat,
  type LoggedShort,
  type PerformanceRow,
} from "./recommend";

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("missing");
  return x;
}

const row = (
  channelId: string,
  format: ArmFormat,
  hookType: HookType,
  avgViewPct: number,
  extra: Partial<Pick<ShortFeatures, "durationS" | "postHour">> = {},
  views = 1000,
): PerformanceRow => ({
  channelId,
  views,
  avgViewPct,
  features: { format, hookType, durationS: extra.durationS ?? 45, postHour: extra.postHour ?? 12 },
});

/**
 * Fixture channel history logged under uniform-random choices: every arm averages 60% view, except a
 * few that work (myth-vs-fact + question 88%, top-3-list + number 80%) and a few that don't (40%).
 */
const TRUE_MEAN = (a: Arm): number => {
  if (a.format === "myth-vs-fact" && a.hookType === "question") return 88;
  if (a.format === "top-3-list" && a.hookType === "number") return 80;
  if (a.hookType === "statement") return 40;
  return 60;
};
function fixtureLog(n: number, seed: string): LoggedShort[] {
  const rng = seededRng(seed);
  return Array.from({ length: n }, () => {
    const arm = must(ARMS[Math.floor(rng() * ARMS.length)]);
    return { ...arm, avgViewPct: Math.max(0, TRUE_MEAN(arm) + 12 * normal(rng)) };
  });
}

describe("offline replay (E10-03 acceptance)", () => {
  const log = fixtureLog(6000, "fixture-channel");

  it("the bandit beats a uniform baseline on avg view %", () => {
    const bandit = replay(log, "bandit", "s1");
    const uniform = replay(log, "uniform", "s1");
    expect(uniform.matched).toBeGreaterThan(150);
    expect(bandit.matched).toBeGreaterThan(150);
    // Uniform lands near the arms' average (~58%); the bandit concentrates on the arms that retain.
    expect(uniform.meanAvgViewPct).toBeLessThan(62);
    expect(bandit.meanAvgViewPct).toBeGreaterThan(uniform.meanAvgViewPct + 10);
  });

  it("wins across several seeds and logs, not just one", () => {
    for (const s of ["a", "b", "c"]) {
      const l = fixtureLog(4000, `log-${s}`);
      expect(replay(l, "bandit", s).meanAvgViewPct).toBeGreaterThan(replay(l, "uniform", s).meanAvgViewPct);
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(replay(log.slice(0, 1500), "bandit", "x")).toEqual(replay(log.slice(0, 1500), "bandit", "x"));
  });
});

describe("armPosteriors", () => {
  it("lift is relative to the channel's own average, so channels with different baselines can share", () => {
    const shared = [
      row("high", "myth-vs-fact", "question", 120),
      row("high", "trend-explainer", "statement", 80),
      row("low", "myth-vs-fact", "question", 60),
      row("low", "trend-explainer", "statement", 40),
    ];
    const p = armPosteriors([], shared);
    const mvf = must(p.find((a) => a.format === "myth-vs-fact" && a.hookType === "question"));
    const te = must(p.find((a) => a.format === "trend-explainer" && a.hookType === "statement"));
    expect(mvf.priorMean).toBeGreaterThan(1);
    expect(te.priorMean).toBeLessThan(1);
    expect(mvf.shorts).toBe(0);
    expect(mvf.priorShorts).toBe(2);
  });

  it("Shorts without results don't count", () => {
    const p = armPosteriors(
      [
        row("ch", "top-3-list", "number", 0, {}, 0),
        { ...row("ch", "top-3-list", "number", 70), avgViewPct: null },
      ],
      [],
    );
    expect(p.every((a) => a.shorts === 0 && a.mean === 1)).toBe(true);
  });
});

describe("recommendFromRows", () => {
  const own = [
    ...Array.from({ length: 6 }, (_, i) =>
      row("ch", "myth-vs-fact", "question", 90 + i, { durationS: 31, postHour: 18 }),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      row("ch", "news-in-60s", "statement", 40 + i, { durationS: 58, postHour: 9 }),
    ),
  ];

  it("favours what retains this channel's audience, with a reason per field", () => {
    const r = recommendFromRows({ channelId: "ch", own, seed: "2026-10-23" });
    expect(Recommendation.safeParse(r).success).toBe(true);
    expect(r.preferredFormats[0]).toBe("myth-vs-fact");
    expect(r.hookPatterns[0]).toBe("question");
    expect(r.targetSeconds).toBe(30);
    expect(r.postHour).toBe(18);
    expect(r.basedOn).toEqual({ shorts: 12, priorShorts: 0, priorChannels: 0 });
    const why = Object.fromEntries(r.why.map((w) => [w.field, w]));
    expect(why.preferredFormats).toMatchObject({ source: "channel", shorts: 6 });
    expect(why.preferredFormats?.text).toContain("Myth vs fact Shorts with a question hook");
    expect(why.preferredFormats?.lift).toBeGreaterThan(1.2);
    expect(why.targetSeconds).toMatchObject({ source: "channel", shorts: 6 });
    expect(why.postHour?.text).toContain("18:00 UTC");
  });

  it("is deterministic for the same seed and data", () => {
    expect(recommendFromRows({ channelId: "ch", own, seed: "d" })).toEqual(
      recommendFromRows({ channelId: "ch", own, seed: "d" }),
    );
  });

  it("a new channel starts from the shared prior of opted-in channels, and says so", () => {
    const shared = [
      ...Array.from({ length: 10 }, () =>
        row("other", "top-3-list", "number", 95, { durationS: 60, postHour: 20 }),
      ),
      ...Array.from({ length: 10 }, () =>
        row("other", "trend-explainer", "statement", 45, { durationS: 30, postHour: 7 }),
      ),
    ];
    const r = recommendFromRows({ channelId: "new", own: [], shared, seed: "d" });
    expect(r.preferredFormats[0]).toBe("top-3-list");
    expect(r.hookPatterns[0]).toBe("number");
    expect(r.targetSeconds).toBe(60);
    expect(r.postHour).toBe(20);
    expect(r.basedOn).toEqual({ shorts: 0, priorShorts: 20, priorChannels: 1 });
    expect(r.why.every((w) => w.source === "shared_prior" && w.shorts === 0)).toBe(true);
    expect(r.why[0]?.text).toContain("similar channels");
  });

  it("the channel's own Shorts never feed its shared prior", () => {
    const r = recommendFromRows({ channelId: "ch", own, shared: own, seed: "d" });
    expect(r.basedOn.priorShorts).toBe(0);
  });

  it("with no data at all it explores and falls back to defaults, saying why", () => {
    const r = recommendFromRows({ channelId: "empty", own: [], seed: "d" });
    expect(r.targetSeconds).toBe(45);
    expect(r.postHour).toBe(17);
    expect(r.preferredFormats).toHaveLength(3);
    expect(r.why.every((w) => w.source === "default")).toBe(true);
    expect(r.why[0]?.text).toMatch(/Not enough results yet/);
  });
});

describe("applyOverride (users can see and override why)", () => {
  const base = recommendFromRows({
    channelId: "ch",
    own: Array.from({ length: 5 }, () => row("ch", "myth-vs-fact", "question", 90, { durationS: 31 })),
    seed: "d",
  });

  it("replaces only the overridden fields and keeps what the data suggested in the reason", () => {
    const r = applyOverride(base, {
      targetSeconds: 60,
      preferredFormats: ["news-in-60s"],
      note: "Testing longer news",
    });
    expect(r.targetSeconds).toBe(60);
    expect(r.preferredFormats).toEqual(["news-in-60s"]);
    expect(r.hookPatterns).toEqual(base.hookPatterns);
    expect(r.postHour).toBe(base.postHour);
    const len = must(r.why.find((w) => w.field === "targetSeconds"));
    expect(len.source).toBe("user");
    expect(len.text).toContain("You chose this: Testing longer news");
    expect(len.text).toContain("Data suggested 30 seconds");
    const hooks = must(r.why.find((w) => w.field === "hookPatterns"));
    expect(hooks).toEqual(base.why.find((w) => w.field === "hookPatterns"));
    expect(Recommendation.safeParse(r).success).toBe(true);
  });

  it("rejects an invalid override", () => {
    expect(() => applyOverride(base, { postHour: 25 })).toThrow();
  });
});

describe("recommend(channelId) with the database", () => {
  let h: DbHandle;
  const req: PublishRequest = {
    platform: "youtube",
    accountId: "acct",
    videoAssetId: SEED.assetIds[0],
    title: "t",
    description: "",
    tags: [],
    privacy: "public",
    aiDisclosure: true,
  };
  const features = (
    format: ArmFormat,
    hookType: HookType,
    durationS: number,
    postHour: number,
  ): ShortFeatures => ({
    hookType,
    hookWords: 6,
    durationS,
    beats: 5,
    captionStyle: "bold-pop",
    voiceId: "v",
    visualMix: { own: 0, stock: 1, ai: 0 },
    format,
    topicVelocity: null,
    postHour,
  });
  let n = 0;
  async function short(
    channelId: string,
    f: ShortFeatures,
    avgViewPct: number,
    ownerId: string = SEED.userId,
  ) {
    const id = `pub_${++n}`;
    await h.db.insert(schema.publishRecords).values({
      id,
      ownerId,
      platform: "youtube",
      channelId,
      videoAssetId: SEED.assetIds[0],
      request: req,
      status: "published",
      externalId: `v_${id}`,
      publishedAt: "2026-10-01T12:00:00Z",
      idempotencyKey: `publish:${id}`,
    });
    await h.db
      .insert(schema.shortFeatures)
      .values({ publishId: id, ownerId, features: f, computedAt: "2026-10-02T00:00:00Z" });
    await h.db.insert(schema.shortMetrics).values({
      publishId: id,
      date: "2026-10-01",
      views: 500,
      avgViewPct,
      likes: 1,
      comments: 0,
      subsGained: 0,
    });
  }

  beforeEach(async () => {
    n = 0;
    h = openDb("memory://");
    await h.migrate();
    await seed(h.db);
    await h.db.insert(schema.users).values({ id: "usr_other", email: "other@example.test", name: "Other" });
    await h.db.insert(schema.channels).values([
      { id: "ch_a", ownerId: SEED.userId, platform: "youtube", externalId: "UC_a", title: "A" },
      { id: "ch_b", ownerId: SEED.userId, platform: "youtube", externalId: "UC_b", title: "B" },
      { id: "ch_o", ownerId: "usr_other", platform: "youtube", externalId: "UC_o", title: "O" },
    ]);
    for (let i = 0; i < 4; i++) {
      await short("ch_a", features("myth-vs-fact", "question", 30, 19), 95);
      await short("ch_a", features("news-in-60s", "statement", 60, 8), 45);
      // Same owner's other channel: never mixed into ch_a's own evidence.
      await short("ch_b", features("news-in-60s", "statement", 60, 8), 99);
      await short("ch_o", features("top-3-list", "number", 45, 21), 90, "usr_other");
      await short("ch_o", features("trend-explainer", "how_why", 45, 6), 40, "usr_other");
    }
  });
  afterEach(() => h.close());

  it("reads the channel's own feature rows and metrics", async () => {
    const r = await recommend(h.db, "ch_a", { seed: "2026-10-23" });
    expect(r.preferredFormats[0]).toBe("myth-vs-fact");
    expect(r.targetSeconds).toBe(30);
    expect(r.postHour).toBe(19);
    expect(r.basedOn).toEqual({ shorts: 8, priorShorts: 0, priorChannels: 0 });
  });

  it("uses only the opted-in channels passed as the shared prior", async () => {
    const r = await recommend(h.db, "ch_a", { seed: "d", priorChannelIds: ["ch_o", "ch_a"] });
    expect(r.basedOn).toEqual({ shorts: 8, priorShorts: 8, priorChannels: 1 });
  });

  it("applies a saved override and defaults the seed to the day", async () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const a = await recommend(h.db, "ch_a", { now, override: { postHour: 7 } });
    expect(a.postHour).toBe(7);
    expect(a.why.find((w) => w.field === "postHour")?.source).toBe("user");
    const b = await recommend(h.db, "ch_a", { seed: "2026-10-23" });
    expect({ ...a, postHour: 0, why: [] }).toEqual({ ...b, postHour: 0, why: [] });
  });

  it("an unknown channel is an error", async () => {
    await expect(recommend(h.db, "nope")).rejects.toThrow(/not found/);
  });
});

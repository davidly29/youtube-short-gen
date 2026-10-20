import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };
let h: DbHandle;
const OTHER = "usr_other";

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  await h.db.insert(schema.users).values({ id: OTHER, email: "other@example.test", name: "Other" });
  await h.db.insert(schema.channels).values([
    { id: "ch_mine", ownerId: SEED.userId, platform: "youtube", externalId: "UC_mine", title: "Mine" },
    {
      id: "ch_theirs",
      ownerId: OTHER,
      platform: "youtube",
      externalId: "UC_theirs",
      title: "Theirs",
      nicheId: "history",
    },
  ]);
  await h.db.insert(schema.briefs).values({
    id: "brief_theirs",
    channelId: "ch_theirs",
    date: "2026-10-20",
    generatedWith: "template",
    partial: true,
    items: [],
  });
  g.__shortloop = Promise.resolve({ db: h.db, fake: false } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  await h.close();
});

const niche = async (id: string) =>
  (await h.db.select().from(schema.channels).where(eq(schema.channels.id, id)))[0]?.nicheId;

describe("daily brief server functions (E3-03b)", () => {
  it("a user sees only their own channels and briefs", async () => {
    const { getTodayBrief } = await import("./brief");
    const mine = await getTodayBrief(SEED.userId);
    expect(mine.map((c) => c.channel.id)).toEqual(["ch_mine"]);
    expect(mine[0]).toMatchObject({ niche: undefined, brief: undefined });
    await expect(getTodayBrief(SEED.userId, "ch_theirs")).rejects.toThrow("Channel not found");
    expect((await getTodayBrief(OTHER, "ch_theirs"))[0]?.brief?.date).toBe("2026-10-20");
  });

  it("a user can't set the niche of another user's channel", async () => {
    const { setChannelNiche } = await import("./brief");
    await expect(setChannelNiche(SEED.userId, "ch_theirs", "tech")).rejects.toThrow("Channel not found");
    expect(await niche("ch_theirs")).toBe("history");
  });

  it("saving a listed niche persists niche_id; an unknown one is refused", async () => {
    const { getTodayBrief, setChannelNiche } = await import("./brief");
    await setChannelNiche(SEED.userId, "ch_mine", "science");
    expect(await niche("ch_mine")).toBe("science");
    expect((await getTodayBrief(SEED.userId))[0]?.niche).toEqual({ id: "science", name: "Science" });
    await expect(setChannelNiche(SEED.userId, "ch_mine", "gardening")).rejects.toThrow(/niche/);
    await expect(setChannelNiche(SEED.userId, "ch_mine", "Robert'); DROP TABLE")).rejects.toThrow(/niche/);
    expect(await niche("ch_mine")).toBe("science");
  });

  it("marks brief topics the user already made a project from", async () => {
    const { getTodayBrief } = await import("./brief");
    await h.db.update(schema.channels).set({ nicheId: "history" }).where(eq(schema.channels.id, "ch_mine"));
    await h.db.insert(schema.briefs).values({
      id: "brief_mine",
      channelId: "ch_mine",
      date: "2026-10-20",
      generatedWith: "template",
      partial: true,
      items: [
        {
          topicId: "top_abc",
          angle: "Angle",
          hook: "Hook",
          format: "trend-explainer",
          whyNow: "3 signals in 24 h, 9.0× the weekly average",
          sources: [{ url: "https://news.example.com/a", title: "A", source: "rss" }],
        },
      ],
    });
    await h.db
      .update(schema.projects)
      .set({ topicId: "top_abc" })
      .where(eq(schema.projects.id, SEED.projectId));
    expect((await getTodayBrief(SEED.userId))[0]?.started).toEqual({ top_abc: SEED.projectId });
  });

  it("the fake brief seed is refused outside fake mode", async () => {
    const { seedFakeBrief } = await import("./brief");
    await expect(seedFakeBrief(SEED.userId)).rejects.toThrow("Not available");
  });
});

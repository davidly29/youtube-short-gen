import { openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };
let h: DbHandle;

const item = (topicId: string, title: string) => ({
  topicId,
  angle: `Why ${title} matters`,
  hook: `${title}: what changed`,
  format: "news-in-60s" as const,
  whyNow: "4 signals in 24 h",
  sources: [{ url: "https://example.org/a", title, source: "rss" as const }],
});

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  await h.db.insert(schema.users).values({ id: "usr_other", email: "o@example.test" });
  await h.db.insert(schema.channels).values([
    {
      id: "ch_hist",
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UC_h",
      title: "History Fast",
      nicheId: "history",
      scopes: "youtube.upload yt-analytics.readonly",
    },
    {
      id: "ch_other",
      ownerId: "usr_other",
      platform: "youtube",
      externalId: "UC_o",
      title: "Theirs",
      nicheId: "history",
    },
  ]);
  await h.db.insert(schema.briefs).values([
    {
      id: "b1",
      channelId: "ch_hist",
      date: "2026-10-24",
      generatedWith: "template",
      partial: true,
      items: [item("top_roman", "Roman roads"), item("top_salt", "Salt empire")],
    },
    {
      id: "b2",
      channelId: "ch_other",
      date: "2026-10-24",
      generatedWith: "template",
      partial: true,
      items: [item("top_secret", "Not yours")],
    },
  ]);
  await h.db
    .update(schema.projects)
    .set({ topicId: "top_salt", status: "ready" })
    .where((await import("@shortloop/db")).eq(schema.projects.id, SEED.projectId));
  g.__shortloop = Promise.resolve({
    db: h.db,
    fake: true,
    tts: { voices: () => [] },
    stock: [],
    image: { provider: "free" },
    resolve: async () => ({
      route: { image: "free", tts: "free" },
      notices: [],
      usage: { premiumImages: 0 },
    }),
  } as unknown as Runtime);
  vi.stubEnv("BETTER_AUTH_URL", "https://app.test/");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  delete g.__shortloop;
  await h.close();
});

describe("MCP v2 services", () => {
  it("get_trends returns today's brief ideas for the user's own channels, ready for create_short", async () => {
    const { mcpServicesFor } = await import("./mcp-services");
    const out = await mcpServicesFor(SEED.userId).getTrends({});
    expect(out.available).toBe(true);
    expect(out.date).toBe("2026-10-24");
    expect(out.trends.map((t) => t.topic_id)).toEqual(["top_roman", "top_salt"]);
    expect(out.trends[0]).toMatchObject({
      topic: "Roman roads",
      angle: "Why Roman roads matters",
      format: "news-in-60s",
      channel_title: "History Fast",
      already_made: false,
    });
    expect(out.trends[1]?.already_made).toBe(true);
    expect((await mcpServicesFor(SEED.userId).getTrends({ niche: "tech" })).trends).toEqual([]);
  });

  it("get_account names the plan, channels and next steps; list_shorts links into the app", async () => {
    const { mcpServicesFor } = await import("./mcp-services");
    const svc = mcpServicesFor(SEED.userId);
    const acct = await svc.getAccount();
    expect(acct).toMatchObject({ plan: "Free", unlimited: false, ai_scripts: false });
    expect(acct.credits.shorts).toBe(5);
    expect(acct.channels).toEqual([
      expect.objectContaining({ channel_id: "ch_hist", niche: "History", stats: true }),
    ]);
    expect(acct.tips.join(" ")).toMatch(/AI key/);
    expect(acct.app_url).toBe("https://app.test/projects");

    const ready = await svc.listShorts({ status: "ready", limit: 10 });
    expect(ready.shorts).toEqual([
      expect.objectContaining({
        project_id: SEED.projectId,
        app_url: `https://app.test/projects/${SEED.projectId}`,
      }),
    ]);
    expect((await svc.listShorts({ status: "in_progress", limit: 10 })).shorts).toEqual([]);
    expect((await mcpServicesFor("usr_other").listShorts({ status: "any", limit: 10 })).shorts).toEqual([]);
  });
});

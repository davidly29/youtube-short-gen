import { Asset, ChannelStyle, Job, PublishRequest, Script, Timeline } from "@shortloop/contracts";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "./client";
import { toAsset, toJob, toPublishRequest, toScript, toTimeline } from "./mappers";
import { balance } from "./ledger";
import {
  aiUsage,
  assets,
  channels,
  creditLedger,
  jobs,
  projects,
  publishRecords,
  scripts,
  styleProfiles,
  timelines,
  users,
} from "./schema";
import { SEED, seed } from "./seed";

let h: DbHandle;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a row");
  return v;
}

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
});
afterEach(async () => {
  await h.close();
});

const tableNames = async () => {
  const res = await h.db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  return (res as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
};

describe("migrations", () => {
  it("create every table on an empty database", async () => {
    expect(await tableNames()).toEqual([
      "ai_usage",
      "api_rate_windows",
      "assets",
      "audit_events",
      "auth_accounts",
      "auth_jwks",
      "auth_oauth_access_token",
      "auth_oauth_client",
      "auth_oauth_client_assertion",
      "auth_oauth_client_resource",
      "auth_oauth_consent",
      "auth_oauth_refresh_token",
      "auth_oauth_resource",
      "auth_sessions",
      "auth_verifications",
      "billing_events",
      "briefs",
      "channels",
      "credit_grants",
      "credit_ledger",
      "jobs",
      "projects",
      "provider_routing",
      "public_api_keys",
      "publish_records",
      "scripts",
      "style_profiles",
      "subscriptions",
      "timelines",
      "trend_signals",
      "user_api_keys",
      "users",
      "webhook_deliveries",
      "webhooks",
    ]);
  });

  it("are idempotent", async () => {
    await h.migrate();
    await h.migrate();
    expect(await tableNames()).toHaveLength(34);
  });
});

describe("round trips validate against the contracts", () => {
  beforeEach(async () => {
    await seed(h.db);
  });

  it("asset", async () => {
    const row = await h.db.query.assets.findFirst({ where: eq(assets.id, SEED.assetIds[0]) });
    expect(row).toBeDefined();
    const asset = Asset.parse(toAsset(must(row)));
    expect(asset.licence.attribution).toContain("Pexels");
  });

  it("script", async () => {
    await h.db.insert(scripts).values({
      id: "scr_1",
      projectId: SEED.projectId,
      title: "Octopus hearts",
      hook: "Why three hearts?",
      beats: [{ id: "b1", text: "Why three hearts?", visualQuery: "octopus", estDurationMs: 2000 }],
      cta: "Follow for more.",
      language: "en",
      wordCount: 3,
    });
    const row = await h.db.query.scripts.findFirst({ where: eq(scripts.id, "scr_1") });
    expect(Script.parse(toScript(must(row))).beats).toHaveLength(1);
  });

  it("timeline", async () => {
    await h.db.insert(timelines).values({
      id: "tl_1",
      projectId: SEED.projectId,
      fps: 30,
      width: 1080,
      height: 1920,
      durationMs: 3000,
      video: [
        { assetId: SEED.assetIds[0], startMs: 0, endMs: 3000, srcInMs: 0, fit: "cover", motion: "kenburns" },
      ],
      audio: [],
      captions: [{ text: "Hi", startMs: 0, endMs: 400, emphasis: false }],
      captionStyle: "bold-pop",
    });
    const row = await h.db.query.timelines.findFirst({ where: eq(timelines.id, "tl_1") });
    expect(Timeline.parse(toTimeline(must(row))).durationMs).toBe(3000);
  });

  it("job", async () => {
    await h.db.insert(jobs).values({
      id: "job_1",
      ownerId: SEED.userId,
      type: "render",
      input: { timelineId: "tl_1" },
      idempotencyKey: "render:tl_1",
    });
    const row = await h.db.query.jobs.findFirst({ where: eq(jobs.id, "job_1") });
    const job = Job.parse(toJob(must(row)));
    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
  });

  it("style profile (E4-03), removed with its channel", async () => {
    await h.db.insert(channels).values({
      id: "ch_s",
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UCstyle",
      title: "History Fast",
    });
    const profile = {
      vocabulary: ["empire", "legion"],
      sentenceLength: 7.1,
      hookPatterns: ["Why the …"],
      bannedPhrases: ["let's dive in"],
      examples: ["Why the Roman legion almost never retreated"],
    };
    await h.db.insert(styleProfiles).values({
      channelId: "ch_s",
      ownerId: SEED.userId,
      profile,
      sourceVideoCount: 12,
    });
    const row = must(
      await h.db.query.styleProfiles.findFirst({ where: eq(styleProfiles.channelId, "ch_s") }),
    );
    const parsed = ChannelStyle.parse({
      channelId: row.channelId,
      profile: row.profile,
      sourceVideoCount: row.sourceVideoCount,
      enabled: row.enabled,
      builtAt: new Date(row.builtAt).toISOString(),
    });
    expect(parsed.profile).toEqual(profile);
    expect(parsed.enabled).toBe(true);
    await h.db.delete(channels).where(eq(channels.id, "ch_s"));
    expect(await h.db.select().from(styleProfiles)).toHaveLength(0);
  });

  it("publish record", async () => {
    await h.db.insert(channels).values({
      id: "ch_1",
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UC123",
      title: "Ocean Facts",
    });
    const request = {
      platform: "youtube" as const,
      accountId: "ch_1",
      videoAssetId: SEED.assetIds[0],
      title: "Why octopuses have three hearts",
      description: "#Shorts",
      tags: ["octopus"],
      privacy: "private" as const,
      aiDisclosure: true,
    };
    await h.db.insert(publishRecords).values({
      id: "pub_1",
      ownerId: SEED.userId,
      platform: "youtube",
      channelId: "ch_1",
      videoAssetId: SEED.assetIds[0],
      idempotencyKey: `publish:${SEED.assetIds[0]}:ch_1`,
      request,
    });
    const row = await h.db.query.publishRecords.findFirst({ where: eq(publishRecords.id, "pub_1") });
    expect(PublishRequest.parse(toPublishRequest(must(row)))).toEqual(request);
    expect(must(row).status).toBe("queued");
  });
});

describe("seed", () => {
  it("creates one user, one project and three stock assets, and is idempotent", async () => {
    await seed(h.db);
    await seed(h.db);
    expect(await h.db.$count(users)).toBe(1);
    expect(await h.db.$count(projects)).toBe(1);
    expect(await h.db.$count(assets)).toBe(3);
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });
});

describe("credit ledger", () => {
  beforeEach(async () => {
    await seed(h.db);
  });

  it("balance is the sum of deltas per unit", async () => {
    await h.db.insert(creditLedger).values([
      { ownerId: SEED.userId, unit: "short", delta: -1, reason: "render" },
      { ownerId: SEED.userId, unit: "ai_video_credit", delta: 20, reason: "plan_grant" },
    ]);
    expect(await balance(h.db, SEED.userId, "short")).toBe(4);
    expect(await balance(h.db, SEED.userId, "ai_video_credit")).toBe(20);
    expect(await balance(h.db, "usr_nobody", "short")).toBe(0);
  });

  it("is append-only: updates and deletes are rejected", async () => {
    await expect(h.db.update(creditLedger).set({ delta: 999 })).rejects.toThrow();
    await expect(h.db.delete(creditLedger)).rejects.toThrow();
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });

  it("ai_usage rows can't be edited", async () => {
    await h.db.insert(aiUsage).values({
      ownerId: SEED.userId,
      capability: "image",
      provider: "fal",
      model: "fal-ai/flux/schnell",
      units: 1,
      costUsd: 0.006,
    });
    await expect(h.db.update(aiUsage).set({ costUsd: 0 })).rejects.toThrow();
    expect((await h.db.select().from(aiUsage))[0]?.costUsd).toBe(0.006);
  });

  it("charges a job at most once per reason", async () => {
    await h.db.insert(jobs).values({
      id: "job_2",
      ownerId: SEED.userId,
      type: "render",
      input: {},
      idempotencyKey: "k2",
    });
    const charge = {
      ownerId: SEED.userId,
      unit: "short" as const,
      delta: -1,
      reason: "charge",
      jobId: "job_2",
    };
    await h.db.insert(creditLedger).values(charge);
    await expect(h.db.insert(creditLedger).values(charge)).rejects.toThrow();
  });
});

import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  managedAllowance,
  managedDenial,
  managedDenialMessage,
  managedTier,
  managedUsageSummary,
  recordAiUsage,
  type BudgetContext,
} from "./managed";

let h: DbHandle;
beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
});
afterEach(async () => {
  await h.close();
});

const ON = { MANAGED_AI_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-10-19T12:00:00Z");
const ctx = (extra: Partial<BudgetContext> = {}): BudgetContext => ({
  ownerId: SEED.userId,
  tier: "creator",
  projectId: "prj_a",
  env: ON,
  now: NOW,
  ...extra,
});
const spend = (usd: number, extra: Partial<Parameters<typeof recordAiUsage>[1]> = {}) =>
  recordAiUsage(h.db, {
    ownerId: SEED.userId,
    projectId: "prj_a",
    capability: "image",
    provider: "fal",
    model: "flux",
    units: 1,
    costUsd: usd,
    swap: false,
    ...extra,
  });

const subscribe = (plan: string, status = "active") =>
  h.db.insert(schema.subscriptions).values({ userId: SEED.userId, stripeCustomerId: "cus_1", plan, status });

describe("managedTier", () => {
  it("only active Creator/Pro subscribers and admins get ShortLoop AI", async () => {
    expect(await managedTier(h.db, SEED.userId)).toBeUndefined();
    await subscribe("creator", "canceled");
    expect(await managedTier(h.db, SEED.userId)).toBeUndefined();
    await h.db.update(schema.subscriptions).set({ status: "active" });
    expect(await managedTier(h.db, SEED.userId)).toBe("creator");
    await h.db.update(schema.subscriptions).set({ plan: "pro", status: "trialing" });
    expect(await managedTier(h.db, SEED.userId)).toBe("pro");
  });

  it("beta access-code users don't, admins do", async () => {
    await h.db
      .update(schema.users)
      .set({ creditExempt: true, accessCode: "BETA" })
      .where(eq(schema.users.id, SEED.userId));
    expect(await managedTier(h.db, SEED.userId)).toBeUndefined();
    await h.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, SEED.userId));
    expect(await managedTier(h.db, SEED.userId)).toBe("admin");
  });
});

describe("managedDenial", () => {
  it("is off without the kill switch", async () => {
    expect(await managedDenial(h.db, ctx({ env: {} as NodeJS.ProcessEnv }), "image")).toBe("disabled");
    expect(await managedDenial(h.db, ctx(), "image")).toBeUndefined();
  });

  it("stops everyone once the platform's daily budget is spent", async () => {
    await spend(4, { projectId: "prj_other" });
    const env = { ...ON, MANAGED_AI_DAILY_BUDGET_USD: "4" } as unknown as NodeJS.ProcessEnv;
    expect(await managedDenial(h.db, ctx({ env }), "image")).toBe("platform_budget");
  });

  it("caps a Creator at $7.25 a month (25% of $29); Pro's cap is $19.75", async () => {
    await spend(7.2, { projectId: "prj_big" });
    expect(await managedDenial(h.db, ctx({ projectId: undefined }), "image")).toBeUndefined();
    await spend(0.05, { projectId: "prj_big" });
    expect(await managedDenial(h.db, ctx({ projectId: undefined }), "image")).toBe("monthly_cap");
    expect(await managedDenial(h.db, ctx({ projectId: undefined, tier: "pro" }), "image")).toBeUndefined();
  });

  it("limits one Short to $0.25, or $0.60 when it spent an AI-video credit on premium images", async () => {
    await spend(0.25);
    expect(await managedDenial(h.db, ctx(), "tts")).toBe("per_short");
    expect(await managedDenial(h.db, ctx({ premium: true }), "tts")).toBeUndefined();
  });

  it("allows 5 Shorts a day on Creator; a Short already started today can finish", async () => {
    for (let i = 0; i < 5; i++) await spend(0.01, { projectId: `prj_${i}` });
    expect(await managedDenial(h.db, ctx({ projectId: "prj_6" }), "image")).toBe("daily_shorts");
    expect(await managedDenial(h.db, ctx({ projectId: "prj_4" }), "image")).toBeUndefined();
    expect(await managedDenial(h.db, ctx({ projectId: "prj_6", tier: "pro" }), "image")).toBeUndefined();
  });

  it("drafting scripts or swapping on an older Short doesn't count as a new Short today", async () => {
    for (let i = 0; i < 5; i++)
      await spend(0.002, { projectId: `prj_s${i}`, capability: "llm", provider: "gemini", jobId: `j${i}` });
    expect(await managedDenial(h.db, ctx({ projectId: "prj_real" }), "tts")).toBeUndefined();
    for (let i = 0; i < 5; i++) await spend(0.01, { projectId: `prj_${i}`, capability: "tts" });
    expect(await managedDenial(h.db, ctx({ projectId: "prj_real" }), "tts")).toBe("daily_shorts");
    expect(await managedDenial(h.db, ctx({ projectId: "prj_old", swap: true }), "image")).toBeUndefined();
    expect(
      await managedDenial(h.db, ctx({ projectId: "prj_new_script", jobId: "j9" }), "llm"),
    ).toBeUndefined();
  });

  it("allows 10 AI image swaps per Short", async () => {
    for (let i = 0; i < 10; i++) await spend(0.001, { swap: true });
    expect(await managedDenial(h.db, ctx({ swap: true }), "image")).toBe("swaps");
    expect(await managedDenial(h.db, ctx(), "image")).toBeUndefined(); // the production itself isn't a swap
  });

  it("allows 4 script generations per project; calls within the current job don't count", async () => {
    for (let i = 0; i < 4; i++)
      await spend(0.001, { capability: "llm", provider: "gemini", jobId: `job_${i}` });
    expect(await managedDenial(h.db, ctx({ jobId: "job_new" }), "llm")).toBe("scripts");
    expect(await managedDenial(h.db, ctx({ jobId: "job_3" }), "llm")).toBeUndefined();
  });

  it("explains the denial and what happens instead", () => {
    expect(managedDenialMessage("monthly_cap", "image")).toBe(
      "You've used this month's ShortLoop AI allowance. Using the free images instead.",
    );
    expect(managedDenialMessage("monthly_cap", "llm")).toMatch(/Add your own AI key in Settings → API keys/);
  });
});

describe("usage reporting", () => {
  it("summarises spend for the admin page and the user's allowance", async () => {
    await subscribe("creator");
    await spend(0.5);
    await spend(0.25, { projectId: "prj_b" });
    const s = await managedUsageSummary(h.db, { now: new Date(), env: ON });
    expect(s.todayUsd).toBeCloseTo(0.75);
    expect(s.users).toEqual([expect.objectContaining({ ownerId: SEED.userId, monthUsd: 0.75, calls: 2 })]);
    expect(await managedAllowance(h.db, SEED.userId, { env: ON })).toEqual({
      tier: "creator",
      usedUsd: 0.75,
      limitUsd: 7.25,
      enabled: true,
    });
  });
});

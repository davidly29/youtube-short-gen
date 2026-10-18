import { balance, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimate, InsufficientCreditsError, refund, reserve, settle } from "./credits";

let h: DbHandle;
beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db); // +5 short credits
});
afterEach(async () => {
  await h.close();
});

const job = async (id: string) => {
  await h.db
    .insert(schema.jobs)
    .values({ id, ownerId: SEED.userId, type: "render", input: {}, idempotencyKey: id });
  return id;
};

describe("estimate", () => {
  it("prices Shorts and generative seconds", () => {
    expect(estimate({ shorts: 1 })).toEqual({ short: 1 });
    expect(estimate({ shorts: 1, aiVideoSeconds: 12 })).toEqual({ short: 1, ai_video_credit: 3 });
  });
});

describe("reserve / settle / refund", () => {
  it("fails with INSUFFICIENT_CREDITS when the balance is too low", async () => {
    const id = await job("j1");
    await expect(reserve(h.db, SEED.userId, { short: 6 }, id)).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });
    await expect(reserve(h.db, SEED.userId, { ai_video_credit: 1 }, id)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });

  it("settle charges the actual cost and releases the remainder", async () => {
    const id = await job("j2");
    await reserve(h.db, SEED.userId, { short: 3 }, id);
    expect(await balance(h.db, SEED.userId, "short")).toBe(2);
    await settle(h.db, id, { short: 1 });
    expect(await balance(h.db, SEED.userId, "short")).toBe(4);
    await settle(h.db, id, { short: 1 }); // idempotent
    expect(await balance(h.db, SEED.userId, "short")).toBe(4);
  });

  it("refund returns everything a failed job holds", async () => {
    const id = await job("j3");
    await reserve(h.db, SEED.userId, { short: 2 }, id);
    await refund(h.db, id);
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });

  it("concurrent reserves never overdraw (100 parallel calls for 1 credit each, 5 available)", async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, (_, i) => job(`c${i}`)));
    const results = await Promise.allSettled(ids.map((id) => reserve(h.db, SEED.userId, { short: 1 }, id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await balance(h.db, SEED.userId, "short")).toBe(0);
  });
});

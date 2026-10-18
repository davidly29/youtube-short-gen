import { balance, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobService, MemoryEventBus, MemoryQueueDriver, refundJob, type JobUpdated } from "./jobs";

let h: DbHandle;
let driver: MemoryQueueDriver;
let bus: MemoryEventBus;
let jobs: JobService;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  driver = new MemoryQueueDriver();
  bus = new MemoryEventBus();
  jobs = new JobService(h.db, driver, bus);
});
afterEach(async () => {
  await driver.close();
  await bus.close();
  await h.close();
});

const opts = (key: string) => ({ idempotencyKey: key, ownerId: SEED.userId });

describe("enqueue", () => {
  it("returns the same job for a duplicate idempotency key and queues it once", async () => {
    let runs = 0;
    jobs.register("script", async () => {
      runs++;
      return { ok: true };
    });
    const a = await jobs.enqueue("script", { topic: "octopus" }, opts("script:prj_1"));
    const b = await jobs.enqueue("script", { topic: "different" }, opts("script:prj_1"));
    expect(b.id).toBe(a.id);
    await driver.drain();
    expect(runs).toBe(1);
    expect((await jobs.get(a.id))?.status).toBe("succeeded");
    expect(await h.db.$count(schema.jobs)).toBe(1);
  });

  it("stores the handler output on success", async () => {
    jobs.register("render", async () => ({ videoAssetId: "ast_9" }));
    const job = await jobs.enqueue("render", { timelineId: "tl_1" }, opts("render:tl_1"));
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.output).toEqual({ videoAssetId: "ast_9" });
    expect(done?.progress).toBe(1);
  });
});

describe("failure handling", () => {
  it("retries 3 times, then marks the job failed and refunds its charge", async () => {
    let attempts = 0;
    jobs.register("render", async () => {
      attempts++;
      throw new Error("ffmpeg exploded");
    });
    const job = await jobs.enqueue("render", {}, opts("render:boom"));
    await h.db.insert(schema.creditLedger).values({
      ownerId: SEED.userId,
      unit: "short",
      delta: -1,
      reason: "charge",
      jobId: job.id,
    });
    expect(await balance(h.db, SEED.userId, "short")).toBe(4);

    await driver.drain();

    expect(attempts).toBe(3);
    const failed = await jobs.get(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("ffmpeg exploded");
    const refunds = await h.db.query.creditLedger.findMany({
      where: (l, { and, eq }) => and(eq(l.jobId, job.id), eq(l.reason, "refund:short")),
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.delta).toBe(1);
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });

  it("succeeds on a later attempt without refunding", async () => {
    let attempts = 0;
    jobs.register("voice", async () => {
      attempts++;
      if (attempts < 2) throw new Error("flaky");
      return {};
    });
    const job = await jobs.enqueue("voice", {}, opts("voice:flaky"));
    await driver.drain();
    expect(attempts).toBe(2);
    expect((await jobs.get(job.id))?.status).toBe("succeeded");
  });

  it("refundJob is idempotent", async () => {
    jobs.register("render", async () => ({}));
    const job = await jobs.enqueue("render", {}, opts("render:refund"));
    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: SEED.userId, unit: "short", delta: -2, reason: "charge", jobId: job.id });
    await refundJob(h.db, job.id);
    await refundJob(h.db, job.id);
    expect(await balance(h.db, SEED.userId, "short")).toBe(5);
  });
});

describe("progress events", () => {
  it("reach a subscriber in order, ending with succeeded at progress 1", async () => {
    const events: JobUpdated[] = [];
    jobs.subscribe((e) => events.push(e));
    jobs.register("visuals", async ({ onProgress }) => {
      await onProgress(0.25);
      await onProgress(0.5);
      await onProgress(0.4); // never goes backwards
      await onProgress(0.9);
      return {};
    });
    await jobs.enqueue("visuals", {}, opts("visuals:p"));
    await driver.drain();
    expect(events.map((e) => e.status)).toEqual([
      "queued",
      "running",
      "running",
      "running",
      "running",
      "running",
      "succeeded",
    ]);
    const progress = events.map((e) => e.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });
});

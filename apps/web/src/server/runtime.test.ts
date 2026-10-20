import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, hourBucket, openDb, schema, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver } from "@shortloop/pipeline";
import { FakeTrendCollector, LocalStorage } from "@shortloop/providers";
import { createWorker, trendsJobKey } from "@shortloop/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allInOneTrendCollectors, runtime, startAllInOneTrends, type Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shortloop-runtime-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete g.__shortloop;
  await rm(dir, { recursive: true, force: true });
});

async function until<T>(fn: () => Promise<T | undefined>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("all-in-one runtime trend collection (E3-01e)", () => {
  it("with fake providers, collects this hour's trends in-process and stores signals", async () => {
    vi.stubEnv("DATABASE_URL", "memory://");
    vi.stubEnv("SHORTLOOP_FAKE_PROVIDERS", "1");
    vi.stubEnv("STORAGE_DIR", dir);
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("TRENDS_REGIONS", "IE");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
    const hour = hourBucket(new Date().toISOString());

    const rt = await runtime();
    expect(rt.mode).toBe("all-in-one");
    const key = trendsJobKey("IE", hour);
    const job = await until(async () => {
      const [row] = await rt.db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key));
      return row?.status === "succeeded" ? row : undefined;
    });
    expect(job.type).toBe("trends");
    const signals = await rt.db.select().from(schema.trendSignals);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.title.startsWith("Fake "))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses fake collectors in fake mode", () => {
    const collectors = allInOneTrendCollectors(true);
    expect(collectors).toHaveLength(1);
    expect(collectors[0]).toBeInstanceOf(FakeTrendCollector);
  });

  describe("startAllInOneTrends", () => {
    let h: DbHandle;
    let driver: MemoryQueueDriver;
    beforeEach(async () => {
      h = openDb("memory://");
      await h.migrate();
      driver = new MemoryQueueDriver();
    });
    afterEach(async () => {
      await driver.close();
      await h.close();
    });
    const jobs = () =>
      createWorker({
        db: h.db,
        driver,
        bus: new MemoryEventBus(),
        storage: new LocalStorage(dir),
        trendCollectors: [new FakeTrendCollector()],
      });
    const trendJobs = () => h.db.select().from(schema.jobs).where(eq(schema.jobs.type, "trends"));

    it("queue mode doesn't start a second schedule (the worker service schedules)", async () => {
      const enqueue = vi.fn();
      const svc = jobs();
      svc.enqueue = enqueue;
      const stop = startAllInOneTrends("queue", svc, h.db, {});
      await new Promise((r) => setTimeout(r, 100));
      stop();
      expect(enqueue).not.toHaveBeenCalled();
      expect(await trendJobs()).toHaveLength(0);
    });

    it("all-in-one mode schedules one job per region plus the global feed job", async () => {
      const stop = startAllInOneTrends("all-in-one", jobs(), h.db, { TRENDS_REGIONS: "IE,GB" });
      const rows = await until(async () => {
        const r = await trendJobs();
        return r.length === 3 ? r : undefined;
      });
      stop();
      expect(rows.map((r) => r.idempotencyKey.split(":")[1]).sort()).toEqual(["GB", "IE", "global"]);
    });

    it("a bad TRENDS_* value disables collection with a log line instead of crashing the app", async () => {
      const stop = startAllInOneTrends("all-in-one", jobs(), h.db, { TRENDS_REGIONS: "Ireland" });
      stop();
      expect(console.error).toHaveBeenCalledWith(
        "trend collection disabled:",
        expect.stringMatching(/two-letter region code/),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(await trendJobs()).toHaveLength(0);
    });
  });
});

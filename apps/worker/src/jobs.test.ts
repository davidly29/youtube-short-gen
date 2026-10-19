import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import { LocalStorage } from "@shortloop/providers";
import { checkDeliverySpec } from "@shortloop/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
let jobs: JobService;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "worker-"));
  storage = new LocalStorage(dir);
  driver = new MemoryQueueDriver();
  jobs = createWorker({ db: h.db, driver, bus: new MemoryEventBus(), storage });
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

describe("worker jobs", () => {
  it("renders the fixture Short and uploads a spec-compliant MP4 to storage", async () => {
    const job = await jobs.enqueue(
      "render",
      { fixture: true },
      { idempotencyKey: "smoke", ownerId: SEED.userId },
    );
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status).toBe("succeeded");
    const key = done?.output?.storageKey as string;
    expect(key).toBe(`renders/${job.id}.mp4`);
    expect(await storage.exists(key)).toBe(true);
    expect(await checkDeliverySpec(storage.path(key), 3000)).toEqual([]);
  });

  it("stages that aren't built or configured fail after retries instead of hanging", async () => {
    const job = await jobs.enqueue("trends", {}, { idempotencyKey: "trends", ownerId: SEED.userId });
    const pub = await jobs.enqueue("publish", {}, { idempotencyKey: "pub", ownerId: SEED.userId });
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/no trend collectors configured/);
    expect((await jobs.get(pub.id))?.error).toMatch(/needs a Google OAuth client/);
  });

  it("rejects a render whose timeline is invalid", async () => {
    const job = await jobs.enqueue(
      "render",
      { timeline: { id: "bad", durationMs: 999_999 } },
      { idempotencyKey: "bad", ownerId: SEED.userId },
    );
    await driver.drain();
    expect((await jobs.get(job.id))?.status).toBe("failed");
  });
});

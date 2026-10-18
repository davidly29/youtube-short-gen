import { openDb, schema, seed, SEED, eq, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver } from "@shortloop/pipeline";
import { FakeLLM, FakeTTS, keyAad, LocalStorage, SecretBox, type LLM } from "@shortloop/providers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserKeys, userKeyResolver } from "./keys";
import { createWorker, NEEDS_KEY } from "./worker";

let h: DbHandle;
let dir: string;
let driver: MemoryQueueDriver;
const box = new SecretBox("worker-test-master-key-123456");

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "keys-"));
  driver = new MemoryQueueDriver();
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

const saveKey = (provider: "gemini" | "openai", key: string, updatedAt = new Date().toISOString()) =>
  h.db.insert(schema.userApiKeys).values({
    id: `key_${provider}`,
    ownerId: SEED.userId,
    provider,
    secret: box.seal(key, keyAad(SEED.userId, provider)),
    last4: key.slice(-4),
    updatedAt,
  });

const scriptInput = {
  projectId: SEED.projectId,
  topic: "octopus hearts",
  targetSeconds: 30,
  tone: "curious",
  language: "en",
};

describe("BYOK in the worker", () => {
  it("decrypts only the owner's keys and skips unreadable rows", async () => {
    await saveKey("gemini", "AIza-owner-key");
    await h.db.insert(schema.userApiKeys).values({
      id: "key_bad",
      ownerId: SEED.userId,
      provider: "openai",
      secret: "v1.garbage.x.y",
      last4: "xxxx",
    });
    const keys = await loadUserKeys(h.db, box, SEED.userId);
    expect(keys.map((k) => [k.provider, k.key])).toEqual([["gemini", "AIza-owner-key"]]);
    expect(await loadUserKeys(h.db, box, "usr_someone_else")).toEqual([]);
  });

  it("without a key of their own (and no shared key) the script job fails with a clear next step", async () => {
    const jobs = createWorker({
      db: h.db,
      driver,
      bus: new MemoryEventBus(),
      storage: new LocalStorage(dir),
      providers: { tts: new FakeTTS() },
      providersFor: userKeyResolver(h.db, box, { fake: true }),
    });
    const job = await jobs.enqueue("script", scriptInput, { idempotencyKey: "nokey", ownerId: SEED.userId });
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toBe(NEEDS_KEY.llm);
  });

  it("runs the script job on the owner's own LLM, which overrides the platform default", async () => {
    await saveKey("gemini", "AIza-owner-key");
    const used: string[] = [];
    const platformLLM: LLM = new FakeLLM(() => {
      used.push("platform");
      throw new Error("platform LLM must not be used");
    });
    const jobs = createWorker({
      db: h.db,
      driver,
      bus: new MemoryEventBus(),
      storage: new LocalStorage(dir),
      providers: { llm: platformLLM, tts: new FakeTTS() },
      providersFor: async (ownerId) => {
        const p = await userKeyResolver(h.db, box, { fake: true })(ownerId);
        if (p.llm) used.push("own");
        return p;
      },
    });
    const job = await jobs.enqueue("script", scriptInput, { idempotencyKey: "own", ownerId: SEED.userId });
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status, done?.error).toBe("succeeded");
    expect(used).toEqual(["own"]);
    const script = await h.db.query.scripts.findFirst({
      where: eq(schema.scripts.id, String(done?.output?.scriptId)),
    });
    expect(script?.beats.length).toBeGreaterThan(0);
  });
});

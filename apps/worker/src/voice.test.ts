import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DbHandle, eq, openDb, schema, SEED, seed } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import { FakeLLM, FakeTTS, isMonotonic, LocalStorage, measureLufs } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
let jobs: JobService;

const draft = (topic: string, words: number) => {
  const per = Math.floor((words - 3) / 5);
  const w = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  return JSON.stringify({
    title: topic,
    hook: "Did you know this?",
    beats: Array.from({ length: 5 }, (_, i) => ({
      text: i === 0 ? `Did you know this? ${w(per - 4)}.` : `${w(per)}.`,
      visualQuery: `${topic} shot ${i}`,
    })),
    cta: "Follow for more.",
  });
};

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "voice-"));
  storage = new LocalStorage(dir);
  driver = new MemoryQueueDriver();
  const llm = new FakeLLM((req) => draft("octopus", Number(/must be (\d+) ±10%/.exec(req.system)?.[1])));
  jobs = createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage,
    providers: { llm, tts: new FakeTTS() },
  });
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

const own = (key: string) => ({ idempotencyKey: key, ownerId: SEED.userId });

describe("script -> voice", () => {
  it("writes a script row, then a −14 LUFS voice asset with monotonic word timings", async () => {
    const s = await jobs.enqueue(
      "script",
      {
        projectId: SEED.projectId,
        topic: "why octopuses have three hearts",
        targetSeconds: 30,
        tone: "curious",
        language: "en",
      },
      own("script:1"),
    );
    await driver.drain();
    const scriptJob = await jobs.get(s.id);
    expect(scriptJob?.status, scriptJob?.error).toBe("succeeded");
    const scriptId = scriptJob?.output?.scriptId as string;
    expect(await h.db.query.scripts.findFirst({ where: eq(schema.scripts.id, scriptId) })).toBeDefined();

    const v = await jobs.enqueue("voice", { scriptId, voiceId: "fake-voice" }, own("voice:1"));
    await driver.drain();
    const voiceJob = await jobs.get(v.id);
    expect(voiceJob?.status, voiceJob?.error).toBe("succeeded");
    const out = voiceJob?.output as {
      audioAssetId: string;
      words: { startMs: number; endMs: number; text: string }[];
    };
    expect(isMonotonic(out.words)).toBe(true);
    const asset = await h.db.query.assets.findFirst({ where: eq(schema.assets.id, out.audioAssetId) });
    expect(asset?.source).toBe("ai_generated");
    expect(Math.abs((await measureLufs(storage.path(asset?.storageKey ?? ""))) + 14)).toBeLessThanOrEqual(1);
  });

  it("blocks topics that fail the content policy", async () => {
    const s = await jobs.enqueue(
      "script",
      {
        projectId: SEED.projectId,
        topic: "Pikachu explains crypto",
        targetSeconds: 30,
        tone: "fun",
        language: "en",
      },
      own("script:bad"),
    );
    await driver.drain();
    const done = await jobs.get(s.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/trademarked/i);
  });
});

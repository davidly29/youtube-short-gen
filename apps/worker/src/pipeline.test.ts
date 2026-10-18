import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema, seed, SEED, eq, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, reserve, type JobService } from "@shortloop/pipeline";
import { FakeImage, FakeLLM, FakeStock, FakeTTS, LocalStorage, runFfmpeg } from "@shortloop/providers";
import { checkDeliverySpec } from "@shortloop/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
let pngBytes: Buffer;

const draft = (words: number) => {
  const per = Math.floor((words - 3) / 5);
  const w = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  return JSON.stringify({
    title: "Octopus hearts",
    hook: "Did you know this?",
    beats: Array.from({ length: 5 }, (_, i) => ({
      text: i === 0 ? `Did you know this? ${w(per - 4)}.` : `${w(per)}.`,
      visualQuery: ["octopus close up", "octopus gills", "coral reef", "deep sea", "octopus swimming"][i],
    })),
    cta: "Follow for more.",
  });
};

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "e2e-"));
  storage = new LocalStorage(join(dir, "store"));
  driver = new MemoryQueueDriver();
  const png = join(dir, "stock.png");
  await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=1", "-frames:v", "1", png]);
  pngBytes = await readFile(png);
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

function worker(withStock: boolean): JobService {
  return createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage,
    providers: {
      llm: new FakeLLM((req) => draft(Number(/must be (\d+) ±10%/.exec(req.system)?.[1]))),
      tts: new FakeTTS(),
      image: new FakeImage(),
      stock: withStock ? [new FakeStock()] : [],
      fetch: (async () => new Response(pngBytes)) as unknown as typeof fetch,
    },
  });
}

async function run(
  jobs: JobService,
  type: Parameters<JobService["enqueue"]>[0],
  input: Record<string, unknown>,
  key: string,
) {
  const job = await jobs.enqueue(type, input, { idempotencyKey: key, ownerId: SEED.userId });
  await driver.drain();
  const done = await jobs.get(job.id);
  expect(done?.status, `${type}: ${done?.error}`).toBe("succeeded");
  return { job: done, output: done?.output ?? {} };
}

describe("topic to finished Short (fakes for every provider)", () => {
  it("script -> voice -> visuals (stock) -> render with captions, manifest, thumbnail and settled credits", async () => {
    const jobs = worker(true);
    const s = await run(
      jobs,
      "script",
      {
        projectId: SEED.projectId,
        topic: "octopus hearts",
        targetSeconds: 30,
        tone: "curious",
        language: "en",
      },
      "s",
    );
    const v = await run(jobs, "voice", { scriptId: s.output.scriptId, voiceId: "fake-voice" }, "v");
    const vis = await run(
      jobs,
      "visuals",
      {
        scriptId: s.output.scriptId,
        voice: {
          audioAssetId: v.output.audioAssetId,
          durationMs: v.output.durationMs,
          words: v.output.words,
        },
        captionStyle: "bold-pop",
      },
      "vis",
    );
    const renderJob = await jobs.enqueue(
      "render",
      { timelineId: vis.output.timelineId },
      { idempotencyKey: "r", ownerId: SEED.userId },
    );
    await reserve(h.db, SEED.userId, { short: 1 }, renderJob.id);
    await driver.drain();
    const r = await jobs.get(renderJob.id);
    expect(r?.status, r?.error).toBe("succeeded");
    const out = r?.output as {
      videoAssetId: string;
      storageKey: string;
      manifestKey: string;
      thumbnailKey: string;
      durationMs: number;
    };

    expect(await checkDeliverySpec(storage.path(out.storageKey), out.durationMs)).toEqual([]);
    expect(await storage.exists(out.thumbnailKey)).toBe(true);
    const manifest = JSON.parse(await readFile(storage.path(out.manifestKey), "utf8")) as {
      entries: { source: string }[];
    };
    expect(manifest.entries.map((e) => e.source).sort()).toContain("stock");
    const render = await h.db.query.assets.findFirst({ where: eq(schema.assets.id, out.videoAssetId) });
    expect(render?.source).toBe("render");
    const ledger = await h.db.query.creditLedger.findMany({
      where: eq(schema.creditLedger.jobId, renderJob.id),
    });
    expect(ledger.map((l) => l.reason)).toEqual(["reserve:short"]); // charged 1, nothing to release
  }, 180_000);

  it("falls back to AI images when no stock provider is configured", async () => {
    const jobs = worker(false);
    const s = await run(
      jobs,
      "script",
      {
        projectId: SEED.projectId,
        topic: "octopus hearts",
        targetSeconds: 30,
        tone: "curious",
        language: "en",
      },
      "s2",
    );
    const v = await run(jobs, "voice", { scriptId: s.output.scriptId, voiceId: "fake-voice" }, "v2");
    const vis = await run(
      jobs,
      "visuals",
      {
        scriptId: s.output.scriptId,
        voice: {
          audioAssetId: v.output.audioAssetId,
          durationMs: v.output.durationMs,
          words: v.output.words,
        },
        captionStyle: "karaoke",
      },
      "vis2",
    );
    const tl = await h.db.query.timelines.findFirst({
      where: eq(schema.timelines.id, vis.output.timelineId as string),
    });
    const ids = tl?.video.map((c) => c.assetId) ?? [];
    const rows = await h.db.query.assets.findMany();
    expect(rows.filter((a) => ids.includes(a.id)).every((a) => a.source === "ai_generated")).toBe(true);
  }, 120_000);

  it("refuses to render a timeline that uses an unlicensed asset, and refunds", async () => {
    const jobs = worker(true);
    await h.db.insert(schema.assets).values({
      id: "ast_bad",
      ownerId: SEED.userId,
      kind: "image",
      source: "upload",
      licence: { type: "owned" },
      storageKey: "x.png",
    });
    await h.db.insert(schema.timelines).values({
      id: "tl_bad",
      projectId: SEED.projectId,
      fps: 30,
      width: 1080,
      height: 1920,
      durationMs: 2000,
      video: [{ assetId: "ast_bad", startMs: 0, endMs: 2000, srcInMs: 0, fit: "cover", motion: "none" }],
      audio: [],
      captions: [],
      captionStyle: "bold-pop",
    });
    const job = await jobs.enqueue(
      "render",
      { timelineId: "tl_bad" },
      { idempotencyKey: "bad", ownerId: SEED.userId },
    );
    await reserve(h.db, SEED.userId, { short: 1 }, job.id);
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/attestation/);
    const ledger = await h.db.query.creditLedger.findMany({ where: eq(schema.creditLedger.jobId, job.id) });
    expect(ledger.map((l) => l.reason).sort()).toEqual(["refund:short", "reserve:short"]);
  }, 60_000);
});

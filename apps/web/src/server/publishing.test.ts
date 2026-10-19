import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import {
  explainPublish,
  initTelemetry,
  MemoryEventBus,
  MemoryQueueDriver,
  type Telemetry,
} from "@shortloop/pipeline";
import { FakeYouTube, LocalStorage, SecretBox } from "@shortloop/providers";
import { channelAad, createWorker } from "@shortloop/worker";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const spans = new InMemorySpanExporter();
let telemetry: Telemetry;
let h: DbHandle;
let dir: string;
let driver: MemoryQueueDriver;
const box = new SecretBox("web-publish-test-master-key-123");
const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };

beforeAll(async () => {
  telemetry = await initTelemetry({
    serviceName: "web-test",
    env: {},
    spanProcessors: [new SimpleSpanProcessor(spans)],
  });
});
afterAll(() => telemetry.shutdown());

beforeEach(async () => {
  spans.reset();
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "webpub-"));
  const storage = new LocalStorage(join(dir, "store"));
  const mp4 = join(dir, "r.mp4");
  await writeFile(mp4, Buffer.alloc(2048, 1));
  await storage.putFile("renders/r.mp4", mp4);
  await h.db.insert(schema.assets).values({
    id: "ast_render",
    ownerId: SEED.userId,
    kind: "video",
    source: "render",
    licence: { type: "composed" },
    storageKey: "renders/r.mp4",
  });
  await h.db.insert(schema.timelines).values({
    id: "tl_1",
    projectId: SEED.projectId,
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs: 4000,
    video: [
      { assetId: SEED.assetIds[0], startMs: 0, endMs: 2000, srcInMs: 0, fit: "cover", motion: "kenburns" },
      { assetId: SEED.assetIds[1], startMs: 2000, endMs: 4000, srcInMs: 0, fit: "cover", motion: "kenburns" },
    ],
    audio: [],
    captions: [],
    captionStyle: "bold-pop",
  });
  await h.db
    .update(schema.projects)
    .set({ status: "approved", timelineId: "tl_1", renderAssetId: "ast_render" })
    .where(eq(schema.projects.id, SEED.projectId));
  await h.db.insert(schema.channels).values({
    id: "ch_web",
    ownerId: SEED.userId,
    platform: "youtube",
    externalId: "UC_web",
    title: "Octo Facts",
    secret: box.seal("refresh-good", channelAad(SEED.userId, "ch_web")),
    status: "connected",
  });
  driver = new MemoryQueueDriver();
  const youtube = new FakeYouTube();
  const jobs = createWorker({ db: h.db, driver, bus: new MemoryEventBus(), storage, box, youtube });
  // Only what publishShort uses; the rest of the runtime isn't needed here.
  g.__shortloop = Promise.resolve({ db: h.db, jobs, youtube, storage, box } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

describe("publish observability (E13-02)", () => {
  it("a publish requested through the web server function is one trace through the worker, explained by job id", async () => {
    const { publishShort } = await import("./publishing");
    const id = await publishShort(
      SEED.userId,
      SEED.projectId,
      {
        channelId: "ch_web",
        title: "Octopus hearts",
        description: "",
        tags: [],
        privacy: "public",
        aiDisclosure: false,
      },
      false,
    );
    await driver.drain();

    const done = spans.getFinishedSpans();
    const web = done.find((s) => s.name === "publish.request");
    const work = done.find((s) => s.name === "job.publish");
    expect(web?.attributes["shortloop.publish_id"]).toBe(id);
    expect(work?.spanContext().traceId).toBe(web?.spanContext().traceId);

    const x = await explainPublish(h.db, id);
    expect(x.status).toBe("published");
    expect(work?.attributes["shortloop.job_id"]).toBe(x.jobId);
    expect(x).toMatchObject({ requestedBy: SEED.userId, traceId: web?.spanContext().traceId });
    expect(x.checks.rights).toBe("passed");
    expect(x.assets.map((a) => a.assetId).sort()).toEqual([SEED.assetIds[0], SEED.assetIds[1]].sort());
    expect(x.events.map((e) => e.type)).toEqual(["publish.requested", "publish.completed"]);
  });
});

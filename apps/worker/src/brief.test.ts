import { readFileSync } from "node:fs";
import { Brief, FormatSlug, type TrendSignal } from "@shortloop/contracts";
import { eq, insertSignals, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import { FakeLLM, LocalStorage } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { briefHandler, briefJobKey, scheduleBriefs } from "./brief";
import { createWorker, type WorkerProviders } from "./worker";

const fx = JSON.parse(
  readFileSync(new URL("../../../packages/pipeline/test/fixtures/trends-7d.json", import.meta.url), "utf8"),
) as { now: string; signals: TrendSignal[] };
const NOW = new Date(fx.now); // 2026-10-20T05:00:00Z
const DATE = "2026-10-20";

let h: DbHandle;
let driver: MemoryQueueDriver;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  await insertSignals(h.db, fx.signals);
  await h.db.insert(schema.channels).values([
    {
      id: "ch_history",
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UC_h",
      title: "Old Stories",
      nicheId: "history",
    },
    { id: "ch_plain", ownerId: SEED.userId, platform: "youtube", externalId: "UC_p", title: "No niche" },
  ]);
  driver = new MemoryQueueDriver();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(async () => {
  // Neither the template nor the fake LLM path may touch the network.
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  await driver.close();
  await h.close();
});

const worker = (providersFor?: (ownerId: string) => Promise<WorkerProviders>): JobService =>
  createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage: new LocalStorage("/tmp/shortloop-brief-unused"),
    providersFor,
    now: () => NOW,
  });

const briefs = () => h.db.select().from(schema.briefs);

/** A model that answers for every topic it's given. */
const fakeLLM = () =>
  new FakeLLM((req) =>
    JSON.stringify({
      items: [...req.prompt.matchAll(/topicId: (\S+)/g)].map((m) => ({
        topicId: m[1],
        angle: `The untold side of ${m[1]}`,
        hook: "You have never heard this part of history",
        format: "top-3-list",
      })),
    }),
  );

describe("brief job (E3-03)", () => {
  it("is scheduled from 05:00 UTC for channels with a niche only", async () => {
    const jobs = worker();
    expect(await scheduleBriefs(jobs, h.db, new Date("2026-10-20T04:59:00Z"))).toEqual([]);
    const queued = await scheduleBriefs(jobs, h.db, NOW);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "trends",
      costCredits: 0,
      idempotencyKey: briefJobKey("ch_history", DATE),
    });
    expect(queued[0]?.input).toMatchObject({ kind: "brief", channelId: "ch_history", date: DATE });
  });

  it("builds and stores a valid template brief without a key: 3–5 items, each with a source URL", async () => {
    const jobs = worker();
    const [job] = await scheduleBriefs(jobs, h.db, NOW);
    await driver.drain();
    const done = await jobs.get(job?.id ?? "");
    expect(done?.status).toBe("succeeded");
    const rows = await briefs();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const brief = Brief.parse({ ...row, channelId: row?.channelId });
    expect(brief).toMatchObject({
      channelId: "ch_history",
      date: DATE,
      generatedWith: "template",
      partial: false,
    });
    expect(brief.items.length).toBeGreaterThanOrEqual(3);
    expect(brief.items.length).toBeLessThanOrEqual(5);
    for (const item of brief.items) {
      expect(item.sources.length).toBeGreaterThanOrEqual(1);
      expect(FormatSlug.options).toContain(item.format);
    }
    expect(brief.items.map((i) => i.angle).join(" ")).toMatch(/Shipwreck|Hoard/);
  });

  it("uses the owner's own LLM key when they have one (generatedWith 'llm')", async () => {
    const llm = fakeLLM();
    const jobs = worker(async (ownerId) => (ownerId === SEED.userId ? { llm } : {}));
    await scheduleBriefs(jobs, h.db, NOW);
    await driver.drain();
    const [row] = await briefs();
    expect(row?.generatedWith).toBe("llm");
    expect(row?.items.every((i) => i.format === "top-3-list")).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });

  it("stores one brief when run twice for the same channel and date", async () => {
    const jobs = worker();
    const a = await scheduleBriefs(jobs, h.db, NOW);
    const b = await scheduleBriefs(jobs, h.db, new Date("2026-10-20T06:00:00Z"));
    expect(b[0]?.id).toBe(a[0]?.id);
    await driver.drain();
    // Running the handler again directly (e.g. a manual re-run) replaces the row, never adds one.
    const run = briefHandler(h.db, { now: () => NOW });
    const job = await jobs.get(a[0]?.id ?? "");
    if (!job) throw new Error("job missing");
    await run({ job, ownerId: SEED.userId, onProgress: async () => undefined } as Parameters<typeof run>[0]);
    const rows = await briefs();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe(DATE);
  });

  it("excludes topics the channel owner made a project from in the last 14 days", async () => {
    const jobs = worker();
    await scheduleBriefs(jobs, h.db, NOW);
    await driver.drain();
    const first = (await briefs())[0]?.items[0]?.topicId;
    expect(first).toBeTruthy();
    await h.db.insert(schema.projects).values({
      id: "prj_topic",
      ownerId: SEED.userId,
      title: "Made from the brief",
      topicId: first,
      createdAt: "2026-10-15T10:00:00Z",
    });
    const run = briefHandler(h.db, { now: () => NOW });
    const job = await jobs.get((await scheduleBriefs(jobs, h.db, NOW))[0]?.id ?? "");
    if (!job) throw new Error("job missing");
    await run({ job, ownerId: SEED.userId, onProgress: async () => undefined } as Parameters<typeof run>[0]);
    const after = (await briefs())[0]?.items.map((i) => i.topicId);
    expect(after).not.toContain(first);

    // A project older than 14 days no longer excludes its topic.
    await h.db
      .update(schema.projects)
      .set({ createdAt: "2026-10-01T10:00:00Z" })
      .where(eq(schema.projects.id, "prj_topic"));
    await run({ job, ownerId: SEED.userId, onProgress: async () => undefined } as Parameters<typeof run>[0]);
    expect((await briefs())[0]?.items.map((i) => i.topicId)).toContain(first);
  });

  it("skips a channel without a niche", async () => {
    const jobs = worker();
    const job = await jobs.enqueue(
      "trends",
      { kind: "brief", channelId: "ch_plain", date: DATE },
      { idempotencyKey: briefJobKey("ch_plain", DATE), ownerId: SEED.userId },
    );
    await driver.drain();
    const done = await jobs.get(job.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.output).toMatchObject({ skipped: "no niche" });
    expect(await briefs()).toHaveLength(0);
  });

  it("stores a partial brief rather than padding when the niche is quiet", async () => {
    await h.db.delete(schema.trendSignals);
    const jobs = worker();
    await scheduleBriefs(jobs, h.db, NOW);
    await driver.drain();
    const [row] = await briefs();
    expect(row).toMatchObject({ partial: true, items: [] });
  });
});

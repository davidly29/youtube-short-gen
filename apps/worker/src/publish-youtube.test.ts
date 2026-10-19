import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishIdempotencyKey, type PublishRequest } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import {
  cassette,
  FakeYouTube,
  HttpYouTube,
  LocalStorage,
  SecretBox,
  type CassetteEntry,
  type YouTubeClient,
} from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channelAad, connectYouTubeChannel, disconnectChannel } from "./channels";
import { requeueHeldPublishes } from "./publish";
import { createWorker } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
const box = new SecretBox("publish-test-master-key-1234567");
const CH = "ch_test";
const RENDER = "ast_render";

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "pub-"));
  storage = new LocalStorage(join(dir, "store"));
  driver = new MemoryQueueDriver();
  // An approved project: a timeline over the seed's licensed stock images and a rendered MP4.
  const mp4 = join(dir, "r.mp4");
  await writeFile(mp4, Buffer.alloc(2048, 1));
  await storage.putFile("renders/r.mp4", mp4);
  await h.db.insert(schema.assets).values({
    id: RENDER,
    ownerId: SEED.userId,
    kind: "video",
    source: "render",
    licence: { type: "composed" },
    storageKey: "renders/r.mp4",
  });
  await h.db.insert(schema.scripts).values({
    id: "scr_1",
    projectId: SEED.projectId,
    title: "Octopus hearts",
    hook: "Why three hearts?",
    beats: [{ id: "b1", text: "Why three hearts?", visualQuery: "octopus", estDurationMs: 2000 }],
    cta: "Follow.",
    language: "en",
    wordCount: 4,
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
    .set({
      status: "approved",
      scriptId: "scr_1",
      timelineId: "tl_1",
      renderAssetId: RENDER,
      settings: { imageStyle: "anime" },
    })
    .where(eq(schema.projects.id, SEED.projectId));
  await addChannel("refresh-good");
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

async function addChannel(refreshToken: string, id = CH) {
  await h.db
    .insert(schema.channels)
    .values({
      id,
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: `UC_${id}`,
      title: "Octo Facts",
      secret: box.seal(refreshToken, channelAad(SEED.userId, id)),
      status: "connected",
    })
    .onConflictDoNothing();
}

const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: "youtube",
  accountId: CH,
  videoAssetId: RENDER,
  title: "Why octopuses have three hearts",
  description: "Three hearts, blue blood.",
  tags: ["octopus"],
  privacy: "public",
  aiDisclosure: false,
  ...over,
});

function worker(youtube: YouTubeClient, dailyUploadLimit?: number): JobService {
  return createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage,
    box,
    youtube,
    dailyUploadLimit,
  });
}

/** What the web app does on "Publish": one record per (video, channel), job keyed the same way. */
async function publish(jobs: JobService, req = request(), channelId = CH) {
  const key = publishIdempotencyKey(req.videoAssetId, channelId);
  await h.db
    .insert(schema.publishRecords)
    .values({
      id: `pub_${channelId}`,
      ownerId: SEED.userId,
      platform: "youtube",
      channelId,
      videoAssetId: req.videoAssetId,
      request: req,
      idempotencyKey: key,
      projectId: SEED.projectId,
    })
    .onConflictDoNothing();
  const job = await jobs.enqueue(
    "publish",
    { publishId: `pub_${channelId}`, projectId: SEED.projectId, request: req },
    { idempotencyKey: key, ownerId: SEED.userId },
  );
  await driver.drain();
  const rec = await h.db.query.publishRecords.findFirst({
    where: eq(schema.publishRecords.id, `pub_${channelId}`),
  });
  return { job: await jobs.get(job.id), rec };
}

describe("publish to YouTube (E8-02)", () => {
  it("happy path against the recorded API cassette creates a publish record with a URL", async () => {
    const rec = JSON.parse(
      await readFile(
        new URL("../../../packages/providers/src/youtube/cassettes/upload-happy.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: CassetteEntry[] };
    const c = cassette(rec.entries);
    const { job, rec: row } = await publish(
      worker(new HttpYouTube({ clientId: "c", clientSecret: "s", redirectUri: "https://x/cb" }, c.fetch)),
    );
    expect(job?.status, job?.error).toBe("succeeded");
    expect(row).toMatchObject({
      status: "published",
      externalId: "dQw4recorded",
      url: "https://www.youtube.com/shorts/dQw4recorded",
    });
    expect(row?.uploadUrl).toContain("upload_id=REC123");
    const meta = JSON.parse(String(c.calls[1]?.body)) as {
      snippet: { description: string; title: string };
      status: Record<string, unknown>;
    };
    expect(meta.snippet.description).toBe(
      "Three hearts, blue blood.\n\n#Shorts\n\nCredits:\nPhoto by A. Diver on Pexels\nPhoto by B. Reef on Pexels",
    );
    expect(meta.status).toMatchObject({
      privacyStatus: "public",
      containsSyntheticMedia: false,
      selfDeclaredMadeForKids: false,
    });
    const audit = await h.db.query.auditEvents.findFirst({
      where: eq(schema.auditEvents.type, "publish.completed"),
    });
    expect(audit?.data).toMatchObject({ jobId: job?.id, videoId: "dQw4recorded" });
    c.assertDone();
  });

  it("retry never double-uploads (idempotency key = render + channel)", async () => {
    const yt = new FakeYouTube();
    const jobs = worker(yt);
    const first = await publish(jobs);
    const again = await publish(jobs);
    expect(again.job?.id).toBe(first.job?.id);
    expect(yt.uploads).toHaveLength(1);
    // Even a fresh job for the same record returns the existing video instead of uploading.
    await jobs.enqueue(
      "publish",
      { publishId: `pub_${CH}`, projectId: SEED.projectId, request: request() },
      { idempotencyKey: "manual-retry", ownerId: SEED.userId },
    );
    await driver.drain();
    expect(yt.uploads).toHaveLength(1);
  });

  it("schedules: uploads private with publishAt and records status scheduled", async () => {
    const yt = new FakeYouTube();
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const { rec } = await publish(worker(yt), request({ scheduledAt: at }));
    expect(rec?.status).toBe("scheduled");
    expect(yt.uploads[0]?.metadata).toMatchObject({ privacyStatus: "private", publishAt: at });
  });

  it("quota exhaustion results in scheduled_next_window, not failure, and goes out when the window opens", async () => {
    const yt = new FakeYouTube();
    yt.quotaLeft = 0;
    const jobs = worker(yt);
    const { job, rec } = await publish(jobs);
    expect(job?.status).toBe("succeeded");
    expect(rec?.status).toBe("scheduled_next_window");
    expect(new Date(rec?.retryAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    yt.quotaLeft = 10;
    expect(await requeueHeldPublishes(h.db, jobs, new Date())).toBe(0); // not yet
    expect(
      await requeueHeldPublishes(h.db, jobs, new Date(new Date(rec?.retryAt ?? 0).getTime() + 1000)),
    ).toBe(1);
    await driver.drain();
    const after = await h.db.query.publishRecords.findFirst({
      where: eq(schema.publishRecords.id, `pub_${CH}`),
    });
    expect(after?.status).toBe("published");
    expect(yt.uploads).toHaveLength(1);
  });

  it("our own daily limit holds posts for the next window too", async () => {
    const yt = new FakeYouTube();
    const jobs = worker(yt, 1);
    await addChannel("refresh-good", "ch_two");
    expect((await publish(jobs)).rec?.status).toBe("published");
    expect((await publish(jobs, request({ accountId: "ch_two" }), "ch_two")).rec?.status).toBe(
      "scheduled_next_window",
    );
    expect(yt.uploads).toHaveLength(1);
  });

  it("an expired grant fails with a reconnect prompt and flags the channel", async () => {
    await h.db.delete(schema.channels).where(eq(schema.channels.id, CH));
    await addChannel("refresh-revoked");
    const { job, rec } = await publish(worker(new FakeYouTube()));
    expect(job?.status).toBe("failed");
    expect(rec?.error).toMatch(/Reconnect the channel/);
    expect((await h.db.query.channels.findFirst({ where: eq(schema.channels.id, CH) }))?.status).toBe(
      "needs_reconnect",
    );
  });

  it("refuses unapproved projects and anything with an unlicensed asset", async () => {
    await h.db.update(schema.projects).set({ status: "ready" }).where(eq(schema.projects.id, SEED.projectId));
    const yt = new FakeYouTube();
    expect((await publish(worker(yt))).rec).toMatchObject({
      status: "failed",
      error: "Approve the Short before publishing.",
    });
    expect(yt.uploads).toHaveLength(0);
  });

  it("refuses a timeline with an unlicensed asset", async () => {
    await h.db.insert(schema.assets).values({
      id: "ast_bad",
      ownerId: SEED.userId,
      kind: "image",
      source: "upload",
      licence: { type: "owned" },
      storageKey: "x.png",
    });
    const tl = await h.db.query.timelines.findFirst({ where: eq(schema.timelines.id, "tl_1") });
    await h.db
      .update(schema.timelines)
      .set({
        video: [
          ...(tl?.video ?? []).slice(0, 1),
          { assetId: "ast_bad", startMs: 2000, endMs: 4000, srcInMs: 0, fit: "cover", motion: "none" },
        ],
      })
      .where(eq(schema.timelines.id, "tl_1"));
    const yt = new FakeYouTube();
    const { rec } = await publish(worker(yt));
    expect(rec?.status).toBe("failed");
    expect(rec?.error).toMatch(/attestation/);
    expect(yt.uploads).toHaveLength(0);
  });

  it("labels synthetic content when realistic AI images are used", async () => {
    await h.db.insert(schema.assets).values({
      id: "ast_ai",
      ownerId: SEED.userId,
      kind: "image",
      source: "ai_generated",
      licence: { type: "ai_generated", provider: "gemini", model: "m", prompt: "p" },
      storageKey: "ai.png",
    });
    await h.db
      .update(schema.timelines)
      .set({
        video: [{ assetId: "ast_ai", startMs: 0, endMs: 4000, srcInMs: 0, fit: "cover", motion: "kenburns" }],
      })
      .where(eq(schema.timelines.id, "tl_1"));
    await h.db
      .update(schema.projects)
      .set({ settings: { imageStyle: "photoreal" } })
      .where(eq(schema.projects.id, SEED.projectId));
    const yt = new FakeYouTube();
    await publish(worker(yt));
    expect(yt.uploads[0]?.metadata.containsSyntheticMedia).toBe(true);
  });
});

describe("connect a YouTube channel (E8-01)", () => {
  it("stores the refresh token encrypted at rest and bound to the channel; disconnect revokes it", async () => {
    const yt = new FakeYouTube(undefined, {
      id: "UC_new",
      title: "New Channel",
      avatarUrl: "https://yt3.test/a.jpg",
    });
    const id = await connectYouTubeChannel(h.db, box, yt, SEED.userId, "fake-code");
    const row = await h.db.query.channels.findFirst({ where: eq(schema.channels.id, id) });
    expect(row).toMatchObject({
      title: "New Channel",
      avatarUrl: "https://yt3.test/a.jpg",
      status: "connected",
    });
    expect(row?.secret).toMatch(/^v1\./);
    expect(row?.secret).not.toContain("refresh-");
    const token = box.open(row?.secret ?? "", channelAad(SEED.userId, id));
    expect(token.startsWith("refresh-")).toBe(true);
    expect(() => box.open(row?.secret ?? "", channelAad("usr_other", id))).toThrow();

    await disconnectChannel(h.db, box, yt, SEED.userId, id);
    expect(yt.revoked).toEqual([token]);
    expect(await h.db.query.channels.findFirst({ where: eq(schema.channels.id, id) })).toMatchObject({
      status: "disconnected",
      secret: null,
    });
  });

  it("won't attach a channel that another account already connected", async () => {
    await h.db.insert(schema.users).values({ id: "usr_2", email: "two@x.test" });
    const yt = new FakeYouTube(undefined, { id: `UC_${CH}`, title: "Octo Facts" });
    await expect(connectYouTubeChannel(h.db, box, yt, "usr_2", "fake-code")).rejects.toThrow(
      /another ShortLoop account/,
    );
    expect(yt.revoked).toHaveLength(1);
  });
});

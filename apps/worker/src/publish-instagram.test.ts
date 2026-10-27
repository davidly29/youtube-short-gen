import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishIdempotencyKey, type PublishRequest } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, type JobService } from "@shortloop/pipeline";
import {
  FakeInstagram,
  FakeYouTube,
  LocalStorage,
  SecretBox,
  SWITCH_TO_PROFESSIONAL,
} from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requeueHeldPublishes } from "./publish";
import {
  connectInstagramAccount,
  INSTAGRAM_CAPTION_MAX,
  instagramCaption,
  openInstagramToken,
  sealInstagramToken,
} from "./publish-instagram";
import { createWorker } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
let ig: FakeInstagram;
const box = new SecretBox("instagram-test-master-key-12345");
const CH = "ch_ig";
const RENDER = "ast_render";
const DAY = 86_400;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "ig-"));
  storage = new LocalStorage(join(dir, "store"));
  driver = new MemoryQueueDriver();
  ig = new FakeInstagram();
  ig.pollsUntilFinished = 2;
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
    .set({ status: "approved", timelineId: "tl_1", renderAssetId: RENDER })
    .where(eq(schema.projects.id, SEED.projectId));
  await addAccount(60 * DAY);
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

/** A connected Instagram Professional account whose long-lived token expires in `expiresInS`. */
async function addAccount(expiresInS: number, token = "ig-token") {
  await h.db.insert(schema.channels).values({
    id: CH,
    ownerId: SEED.userId,
    platform: "instagram",
    externalId: ig.account.userId,
    title: "@fake.reels",
    secret: sealInstagramToken(box, SEED.userId, CH, { accessToken: token, expiresInS }),
    status: "connected",
  });
}

const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: "instagram",
  accountId: CH,
  videoAssetId: RENDER,
  title: "Why octopuses have three hearts",
  description: "Three hearts, blue blood. #ocean",
  tags: [],
  privacy: "public",
  aiDisclosure: false,
  ...over,
});

function worker(): JobService {
  return createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage,
    box,
    youtube: new FakeYouTube(),
    instagram: ig,
    publicBaseUrl: "https://app.example.test",
    instagramReel: { pollIntervalMs: 0, sleep: async () => undefined },
  });
}

/** What the web app does on "Post to Instagram": one record per (video, account), job keyed the same way. */
async function publish(jobs: JobService, req = request()) {
  const key = publishIdempotencyKey(req.videoAssetId, CH);
  await h.db
    .insert(schema.publishRecords)
    .values({
      id: "pub_ig",
      ownerId: SEED.userId,
      platform: "instagram",
      channelId: CH,
      videoAssetId: req.videoAssetId,
      request: req,
      idempotencyKey: key,
      projectId: SEED.projectId,
    })
    .onConflictDoNothing();
  const job = await jobs.enqueue(
    "publish",
    { publishId: "pub_ig", projectId: SEED.projectId, request: req },
    { idempotencyKey: key, ownerId: SEED.userId },
  );
  await driver.drain();
  const rec = await h.db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, "pub_ig") });
  return { job: await jobs.get(job.id), rec };
}

describe("publish-instagram (E8-04b)", () => {
  it("an approved Short publishes as a Reel and the record has the permalink", async () => {
    const { job, rec } = await publish(worker());
    expect(job?.status).toBe("succeeded");
    expect(rec?.status).toBe("published");
    expect(rec?.url).toMatch(/^https:\/\/www\.instagram\.com\/reel\//);
    expect(rec?.externalId).toBe(ig.published[0]?.mediaId);
    expect(ig.published).toHaveLength(1);
    // Polled until the container finished, then published.
    expect(ig.statusChecks).toBe(2);
    // The caption keeps the user's text and appends the stock attributions.
    const caption = ig.published[0]?.caption ?? "";
    expect(caption).toContain("Three hearts, blue blood.");
    expect(caption).toContain("on Pexels");
    // Instagram fetches the exact render from an absolute signed URL.
    expect(ig.published[0]?.videoUrl).toMatch(/^https:\/\/app\.example\.test\/.*renders\/r\.mp4\?expires=/);
    const audit = await h.db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.subjectId, "pub_ig"),
    });
    const done = audit.find((a) => a.type === "publish.completed");
    expect(done?.data).toMatchObject({
      platform: "instagram",
      checks: { rights: "passed", variation: "passed", music: "passed" },
    });
    // A second run of the job never posts twice.
    await publish(worker());
    expect(ig.published).toHaveLength(1);
  });

  it("a rate-limited post ends scheduled_next_window and is re-queued after retryAt", async () => {
    ig.rateLimitNext = 1;
    const jobs = worker();
    const { job, rec } = await publish(jobs);
    expect(job?.status).toBe("succeeded"); // held, not failed
    expect(rec?.status).toBe("scheduled_next_window");
    expect(new Date(rec?.retryAt ?? 0).getTime()).toBeGreaterThan(Date.now());
    expect(ig.published).toHaveLength(0);

    expect(await requeueHeldPublishes(h.db, jobs, new Date())).toBe(0); // not yet
    const after = new Date(new Date(rec?.retryAt ?? 0).getTime() + 1000);
    expect(await requeueHeldPublishes(h.db, jobs, after)).toBe(1);
    await driver.drain();
    const done = await h.db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, "pub_ig") });
    expect(done?.status).toBe("published");
    expect(done?.url).toMatch(/instagram\.com\/reel\//);
    expect(ig.published).toHaveLength(1);
  });

  it("a used-up 24-hour publishing limit also holds the post", async () => {
    ig.limit = { used: 100, total: 100, windowS: DAY };
    const { rec } = await publish(worker());
    expect(rec?.status).toBe("scheduled_next_window");
    expect(ig.containers.size).toBe(0);
  });

  it("refreshes the long-lived token when it has under 7 days left", async () => {
    await h.db.delete(schema.channels).where(eq(schema.channels.id, CH));
    await addAccount(3 * DAY, "ig-old");
    const { rec } = await publish(worker());
    expect(rec?.status).toBe("published");
    const ch = await h.db.query.channels.findFirst({ where: eq(schema.channels.id, CH) });
    const secret = openInstagramToken(box, SEED.userId, CH, ch?.secret ?? "");
    expect(secret.accessToken).toBe("ig-old-r");
    expect(new Date(secret.expiresAt).getTime()).toBeGreaterThan(Date.now() + 50 * DAY * 1000);
    expect(ig.containers.get("cont_1")?.input.accessToken).toBe("ig-old-r");
  });

  it("keeps a token with more than 7 days left", async () => {
    await publish(worker());
    expect(ig.containers.get("cont_1")?.input.accessToken).toBe("ig-token");
  });

  it("an expired token asks to reconnect and posts nothing", async () => {
    await h.db.delete(schema.channels).where(eq(schema.channels.id, CH));
    await addAccount(-60, "ig-dead");
    const { job, rec } = await publish(worker());
    expect(job?.status).toBe("failed");
    expect(rec?.status).toBe("failed");
    expect(rec?.error).toMatch(/Reconnect/);
    const ch = await h.db.query.channels.findFirst({ where: eq(schema.channels.id, CH) });
    expect(ch?.status).toBe("needs_reconnect");
    expect(ig.containers.size).toBe(0);
  });

  it("runs the same checks as YouTube: an unlicensed asset is refused before posting", async () => {
    await h.db
      .update(schema.assets)
      .set({ licence: { type: "stock", provider: "pexels" } })
      .where(eq(schema.assets.id, SEED.assetIds[0]));
    const { job, rec } = await publish(worker());
    expect(job?.status).toBe("failed");
    expect(rec?.status).toBe("failed");
    expect(rec?.error).toMatch(/licence|attribution/);
    expect(ig.containers.size).toBe(0);
  });

  it("an unapproved Short is refused", async () => {
    await h.db.update(schema.projects).set({ status: "draft" }).where(eq(schema.projects.id, SEED.projectId));
    const { rec } = await publish(worker());
    expect(rec?.error).toMatch(/Approve/);
    expect(ig.containers.size).toBe(0);
  });

  it("without an Instagram client the job says it isn't set up", async () => {
    const jobs = createWorker({ db: h.db, driver, bus: new MemoryEventBus(), storage, box });
    const { job } = await publish(jobs);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/INSTAGRAM_APP_ID/);
  });

  it("captions fit Instagram's 2,200 characters and keep the attributions", () => {
    const manifest = {
      entries: [{ attribution: "Photo by Ana on Pexels" }],
    } as unknown as Parameters<typeof instagramCaption>[1];
    const c = instagramCaption("x".repeat(3000), manifest);
    expect(c.length).toBeLessThanOrEqual(INSTAGRAM_CAPTION_MAX);
    expect(c).toContain("Photo by Ana on Pexels");
  });
});

describe("connect an Instagram account (E8-04b)", () => {
  const channels = () => h.db.query.channels.findMany({ where: eq(schema.channels.platform, "instagram") });

  it("a personal account gets the switch-to-Professional message and nothing is stored", async () => {
    await h.db.delete(schema.channels).where(eq(schema.channels.id, CH));
    ig.account = { ...ig.account, userId: "17840000000000099", accountType: "PERSONAL" };
    await expect(connectInstagramAccount(h.db, box, ig, SEED.userId, "fake-code-1")).rejects.toThrow(
      SWITCH_TO_PROFESSIONAL,
    );
    expect(await channels()).toHaveLength(0);
    const audit = await h.db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.type, "channel.connected"),
    });
    expect(audit).toHaveLength(0);
  });

  it("a Professional account is stored with its long-lived token sealed; reconnecting replaces it", async () => {
    await h.db.delete(schema.channels).where(eq(schema.channels.id, CH));
    const id = await connectInstagramAccount(h.db, box, ig, SEED.userId, "fake-code-1");
    const [ch] = await channels();
    expect(ch).toMatchObject({
      id,
      title: "@fake.reels",
      status: "connected",
      externalId: ig.account.userId,
    });
    expect(ch?.secret).not.toContain("ig-"); // sealed, never plaintext
    const first = openInstagramToken(box, SEED.userId, id, ch?.secret ?? "");
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now() + 59 * DAY * 1000);
    expect(await connectInstagramAccount(h.db, box, ig, SEED.userId, "fake-code-2")).toBe(id);
    expect(await channels()).toHaveLength(1);
  });

  it("an account already connected to another ShortLoop user is refused", async () => {
    await h.db.insert(schema.users).values({ id: "usr_other", email: "other@example.test", name: "Other" });
    await h.db.update(schema.channels).set({ ownerId: "usr_other" }).where(eq(schema.channels.id, CH));
    await expect(connectInstagramAccount(h.db, box, ig, SEED.userId, "fake-code-1")).rejects.toThrow(
      /another ShortLoop account/,
    );
  });
});

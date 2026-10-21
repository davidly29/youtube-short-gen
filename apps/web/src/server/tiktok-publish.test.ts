import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { FakeTikTok, LocalStorage, SecretBox, type TikTokClient } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

/**
 * E8-03 server path: connect (fake OAuth), creator_info, the guideline checks re-run on the server, Direct Post with
 * the exact render (no watermark), status refresh, one post per (render, account), disconnect revokes.
 */
let h: DbHandle;
let dir: string;
let storage: LocalStorage;
const box = new SecretBox("web-tiktok-test-master-key-1234");
const g = globalThis as unknown as {
  __shortloop?: Promise<Runtime>;
  __shortloopTikTok?: TikTokClient | null;
};
let tt: FakeTikTok;

const form = {
  title: "Why octopuses have three hearts #ocean",
  privacyLevel: "SELF_ONLY" as const,
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  commercial: false,
  yourBrand: false,
  brandedContent: false,
  aiGenerated: false,
  consent: true,
};

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "webtt-"));
  storage = new LocalStorage(join(dir, "store"), "http://media.test");
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
    durationMs: 4000,
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
  tt = new FakeTikTok();
  g.__shortloopTikTok = tt;
  // Only what the TikTok service and projectView use.
  g.__shortloop = Promise.resolve({ db: h.db, storage, box, fake: true } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  delete g.__shortloopTikTok;
  vi.unstubAllEnvs();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

async function connect() {
  const svc = await import("../../app/(app)/publish/tiktok/service");
  const { url } = await svc.startTikTokConnect();
  const code = new URL(url, "http://x.test").searchParams.get("code") ?? "";
  const id = await svc.finishTikTokConnect(SEED.userId, code);
  return { svc, id };
}

describe("TikTok Direct Post from the web app (E8-03)", () => {
  it("connects, shows creator_info, posts privately while unaudited, and pulls the exact render (no watermark)", async () => {
    const { svc, id } = await connect();
    const ch = await h.db.query.channels.findFirst({ where: eq(schema.channels.id, id) });
    expect(ch).toMatchObject({ platform: "tiktok", title: "Fake Creator", status: "connected" });
    expect(ch?.secret).not.toContain("tt-refresh"); // sealed at rest

    const page = await svc.tiktokPostPage(SEED.userId, SEED.projectId);
    expect(page).toMatchObject({ configured: true, audited: false, approved: true, videoDurationSec: 4 });
    expect(page.creator?.nickname).toBe("Fake Creator");

    // Unaudited: anything but "Only me" is refused on the server too.
    await expect(
      svc.postToTikTok(SEED.userId, SEED.projectId, { ...form, privacyLevel: "PUBLIC_TO_EVERYONE" }),
    ).rejects.toThrow(/only be private/);
    await expect(svc.postToTikTok(SEED.userId, SEED.projectId, { ...form, consent: false })).rejects.toThrow(
      /declaration/,
    );
    await expect(
      svc.postToTikTok(SEED.userId, SEED.projectId, { ...form, allowStitch: true }),
    ).rejects.toThrow(/Stitches are turned off/);
    expect(tt.posts).toHaveLength(0);

    const pubId = await svc.postToTikTok(SEED.userId, SEED.projectId, form);
    expect(tt.posts).toHaveLength(1);
    const sent = tt.posts[0];
    // TikTok pulls our stored render byte-for-byte: a signed URL for the render's own key, nothing re-encoded.
    expect(new URL(sent?.videoUrl ?? "").pathname).toBe("/renders/r.mp4");
    expect(sent).toMatchObject({
      privacyLevel: "SELF_ONLY",
      disableComment: false,
      disableDuet: true,
      disableStitch: true,
      brandContentToggle: false,
      brandOrganicToggle: false,
      title: form.title,
    });
    const rec = await h.db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, pubId) });
    expect(rec).toMatchObject({ platform: "tiktok", status: "uploading", externalId: sent?.publishId });

    // The page refreshes the status: private posts complete without a public link.
    const after = await svc.tiktokPostPage(SEED.userId, SEED.projectId);
    expect(after.publishes).toEqual([expect.objectContaining({ id: pubId, status: "published", url: null })]);

    // One post per (render, account).
    await expect(svc.postToTikTok(SEED.userId, SEED.projectId, form)).rejects.toThrow(
      /already on that TikTok/,
    );

    const events = await h.db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.ownerId, SEED.userId), eq(schema.auditEvents.subjectId, pubId)));
    expect(events.map((e) => e.type).sort()).toEqual(["publish.completed", "publish.requested"]);
    expect(events.find((e) => e.type === "publish.requested")?.data).toMatchObject({
      platform: "tiktok",
      audited: false,
      consent: true,
    });
  });

  it("after the audit (TIKTOK_AUDITED=1) public posts are allowed and link to the video", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "1");
    const { svc } = await connect();
    await svc.postToTikTok(SEED.userId, SEED.projectId, { ...form, privacyLevel: "PUBLIC_TO_EVERYONE" });
    const page = await svc.tiktokPostPage(SEED.userId, SEED.projectId);
    expect(page.audited).toBe(true);
    expect(page.publishes[0]?.url).toBe("https://www.tiktok.com/@fake.creator/video/731000");
  });

  it("a branded-content post can't be private, and the server refuses an unapproved Short", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "1");
    const { svc } = await connect();
    await expect(
      svc.postToTikTok(SEED.userId, SEED.projectId, { ...form, commercial: true, brandedContent: true }),
    ).rejects.toThrow(/Branded content visibility/);
    await h.db
      .update(schema.projects)
      .set({ status: "producing" })
      .where(eq(schema.projects.id, SEED.projectId));
    await expect(svc.postToTikTok(SEED.userId, SEED.projectId, form)).rejects.toThrow(/Approve the Short/);
  });

  it("an expired grant asks to reconnect; disconnect revokes at TikTok and forgets the token", async () => {
    const { svc, id } = await connect();
    await svc.disconnectTikTok(SEED.userId, id);
    expect(tt.revoked).toHaveLength(1);
    const ch = await h.db.query.channels.findFirst({ where: eq(schema.channels.id, id) });
    expect(ch).toMatchObject({ status: "disconnected", secret: null });

    const again = await connect();
    await h.db
      .update(schema.channels)
      .set({ secret: box.seal("tt-refresh-revoked-1", `channel_refresh_token:${SEED.userId}:${again.id}`) })
      .where(eq(schema.channels.id, again.id));
    const page = await again.svc.tiktokPostPage(SEED.userId, SEED.projectId);
    expect(page.creatorError).toMatch(/Reconnect/);
    expect(page.channel?.status).toBe("needs_reconnect");
  });

  it("the YouTube publish path refuses a TikTok account", async () => {
    const { id } = await connect();
    const { publishShort } = await import("./publishing");
    g.__shortloop = Promise.resolve({
      db: h.db,
      storage,
      box,
      fake: true,
      youtube: {},
    } as unknown as Runtime);
    await expect(
      publishShort(
        SEED.userId,
        SEED.projectId,
        { channelId: id, title: "t", description: "", tags: [], privacy: "public", aiDisclosure: false },
        false,
      ),
    ).rejects.toThrow(/YouTube channels/);
  });
});

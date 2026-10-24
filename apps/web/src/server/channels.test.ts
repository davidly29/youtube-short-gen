import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { FakeYouTube, SecretBox } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };
let h: DbHandle;
let youtube: FakeYouTube;
let enqueued: { type: string; input: Record<string, unknown>; key: string }[];

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  youtube = new FakeYouTube();
  enqueued = [];
  g.__shortloop = Promise.resolve({
    db: h.db,
    youtube,
    jobs: {
      enqueue: async (type: string, input: Record<string, unknown>, opts: { idempotencyKey: string }) => {
        enqueued.push({ type, input, key: opts.idempotencyKey });
        return { id: `job_${enqueued.length}` };
      },
    },
    box: new SecretBox("web-channels-test-master-key-123"),
    fake: true,
  } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  await h.close();
});

const onPlan = (plan: "creator" | "pro" | null) =>
  h.db
    .insert(schema.subscriptions)
    .values({ userId: SEED.userId, stripeCustomerId: "cus_t", plan, status: plan ? "active" : "canceled" })
    .onConflictDoUpdate({
      target: schema.subscriptions.userId,
      set: { plan, status: plan ? "active" : "canceled" },
    });

async function connectN(n: number) {
  const { finishYouTubeConnect } = await import("./channels");
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await finishYouTubeConnect(SEED.userId, `fake-code-${i}`));
  return ids;
}

const publishForm = (channelId: string) => ({
  channelId,
  title: "Octopus hearts",
  description: "",
  tags: [],
  privacy: "public" as const,
  aiDisclosure: false,
});

describe("plan channel limits (E1-04)", () => {
  it("Free and Creator users can't connect a second channel; the grant is revoked", async () => {
    const { finishYouTubeConnect, startYouTubeConnect, channelAllowance } = await import("./channels");
    await connectN(1);
    expect(await channelAllowance(SEED.userId)).toMatchObject({ planName: "Free", limit: 1, atLimit: true });
    await expect(startYouTubeConnect(SEED.userId)).rejects.toThrow(/Free plan includes 1 channel\. Upgrade/);
    await expect(finishYouTubeConnect(SEED.userId, "fake-code-x")).rejects.toThrow(/Free plan includes 1/);
    expect(youtube.revoked).toHaveLength(1);

    await onPlan("creator");
    await expect(finishYouTubeConnect(SEED.userId, "fake-code-y")).rejects.toThrow(/Creator plan includes 1/);
  });

  it("Pro users can connect three channels but not a fourth", async () => {
    const { finishYouTubeConnect, startYouTubeConnect } = await import("./channels");
    await onPlan("pro");
    await connectN(3);
    await expect(startYouTubeConnect(SEED.userId)).rejects.toThrow(/Pro plan includes 3 channels/);
    await expect(finishYouTubeConnect(SEED.userId, "fake-code-4")).rejects.toThrow(/Pro plan includes 3/);
    const rows = await h.db.select().from(schema.channels).where(eq(schema.channels.ownerId, SEED.userId));
    expect(rows.filter((r) => r.status === "connected")).toHaveLength(3);
  });

  it("a TikTok account doesn't count towards the YouTube channel limit", async () => {
    const { finishYouTubeConnect, listChannels, channelAllowance } = await import("./channels");
    await h.db.insert(schema.channels).values({
      id: "ch_tt",
      ownerId: SEED.userId,
      platform: "tiktok",
      externalId: "tt_open_1",
      title: "My TikTok",
      status: "connected",
    });
    await expect(finishYouTubeConnect(SEED.userId, "fake-code-yt")).resolves.toMatch(/^ch_/);
    expect(await channelAllowance(SEED.userId)).toMatchObject({ connected: 1, overLimit: false });
    expect((await listChannels(SEED.userId)).every((c) => c.publishable)).toBe(true);
  });

  it("disconnecting one frees the slot", async () => {
    const { disconnect, finishYouTubeConnect } = await import("./channels");
    const [first] = await connectN(1);
    await disconnect(SEED.userId, first ?? "");
    await expect(finishYouTubeConnect(SEED.userId, "fake-code-z")).resolves.toMatch(/^ch_/);
  });

  it("admins have no channel limit; beta (access-code) users get Pro's three", async () => {
    const { channelAllowance } = await import("./channels");
    await h.db.update(schema.users).set({ creditExempt: true }).where(eq(schema.users.id, SEED.userId));
    expect(await channelAllowance(SEED.userId)).toMatchObject({ limit: 3 });
    await h.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, SEED.userId));
    expect(await channelAllowance(SEED.userId)).toMatchObject({ limit: null, atLimit: false });
  });

  it("after a Pro → Creator downgrade channels stay connected, publishing waits until the user picks which stay", async () => {
    const { listChannels, chooseActiveChannels, assertChannelPublishable, channelAllowance } =
      await import("./channels");
    const { publishShort } = await import("./publishing");
    await onPlan("pro");
    const [a, b, c] = (await connectN(3)) as [string, string, string];
    await onPlan("creator");

    const before = await listChannels(SEED.userId);
    expect(before.map((x) => x.status)).toEqual(["connected", "connected", "connected"]);
    expect(before.every((x) => !x.publishable)).toBe(true);
    expect(await channelAllowance(SEED.userId)).toMatchObject({ overLimit: true, mustChoose: true });
    await expect(assertChannelPublishable(SEED.userId, a)).rejects.toThrow(
      /Choose which channels stay active/,
    );
    await h.db
      .update(schema.projects)
      .set({ status: "approved", renderAssetId: SEED.assetIds[0] })
      .where(eq(schema.projects.id, SEED.projectId));
    await expect(publishShort(SEED.userId, SEED.projectId, publishForm(b), false)).rejects.toThrow(
      /Choose which channels stay active/,
    );

    await expect(chooseActiveChannels(SEED.userId, [a, b])).rejects.toThrow(/pick at most 1/);
    await expect(chooseActiveChannels(SEED.userId, ["ch_not_mine"])).rejects.toThrow(/not found/);
    await chooseActiveChannels(SEED.userId, [b]);

    const after = await listChannels(SEED.userId);
    expect(after.filter((x) => x.publishable).map((x) => x.id)).toEqual([b]);
    expect(after.map((x) => x.status)).toEqual(["connected", "connected", "connected"]);
    await expect(assertChannelPublishable(SEED.userId, b)).resolves.toBeUndefined();
    await expect(assertChannelPublishable(SEED.userId, c)).rejects.toThrow(/This channel is paused/);
    const audit = await h.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.type, "channels.active_chosen"));
    expect(audit[0]?.data).toMatchObject({ active: [b], limit: 1 });

    // Upgrading again brings every channel back without another choice.
    await onPlan("pro");
    expect((await listChannels(SEED.userId)).every((x) => x.publishable)).toBe(true);
  });
});

describe("stats backfill on connect (E10-01)", () => {
  it("connecting (or reconnecting) a channel queues its 28-day stats backfill", async () => {
    const [id] = await connectN(1);
    expect(enqueued).toEqual([
      {
        type: "analytics",
        input: { channelId: id, reason: "connect" },
        key: expect.stringMatching(/^analytics:/),
      },
    ]);
  });

  it("a Free user at their limit can still reconnect a channel connected before stats existed", async () => {
    const { startYouTubeConnect } = await import("./channels");
    const [id] = await connectN(1);
    await expect(startYouTubeConnect(SEED.userId)).rejects.toThrow(/Free plan includes 1/);
    await h.db
      .update(schema.channels)
      .set({ scopes: "https://www.googleapis.com/auth/youtube.upload" })
      .where(eq(schema.channels.id, String(id)));
    await expect(startYouTubeConnect(SEED.userId)).resolves.toMatchObject({ state: expect.any(String) });
  });
});

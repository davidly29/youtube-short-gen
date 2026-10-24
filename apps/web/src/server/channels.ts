import "server-only";
import { randomBytes } from "node:crypto";
import { PLANS, PlanId, maxChannelsFor } from "@shortloop/contracts";
import { and, desc, eq, inArray, ne, schema, type Db } from "@shortloop/db";
import { currentSubscription } from "@shortloop/pipeline";
import {
  ChannelLimitError,
  channelsMissingAnalytics,
  connectYouTubeChannel,
  disconnectChannel,
  enqueueAnalytics,
} from "@shortloop/worker";
import { z } from "zod";
import { accessOf } from "./access";
import { UserError } from "./errors";
import { runtime } from "./runtime";

/** httpOnly cookie holding the OAuth state between /start and /callback. */
export const STATE_COOKIE = "yt_oauth_state";

type ChannelRow = typeof schema.channels.$inferSelect;

/**
 * The channels a plan's channel limit counts: the user's YouTube channels that aren't disconnected. TikTok and
 * Instagram accounts (E8-03/E8-04) are outside the E1-04 limit until the owner decides how they count.
 */
const limitedChannels = (userId: string) =>
  and(
    eq(schema.channels.ownerId, userId),
    eq(schema.channels.platform, "youtube"),
    ne(schema.channels.status, "disconnected"),
  );

/** The user's channel allowance (E1-04): Free/Creator 1, Pro 3; admins unlimited (`limit: null`). */
export async function channelAllowance(userId: string, db?: Db) {
  const conn = db ?? (await runtime()).db;
  const [sub, access, rows] = await Promise.all([
    currentSubscription(conn, userId),
    accessOf(userId),
    conn.select().from(schema.channels).where(limitedChannels(userId)),
  ]);
  const plan = sub && sub.plan && sub.status !== "canceled" ? PlanId.parse(sub.plan) : null;
  const max = maxChannelsFor(plan, access);
  const limit = Number.isFinite(max) ? max : null;
  return { planName: plan ? PLANS[plan].name : "Free", limit, ...publishableOf(rows, limit) };
}
export type ChannelAllowance = Awaited<ReturnType<typeof channelAllowance>>;

/**
 * Within the limit every connected channel can publish. Over it (after a downgrade) only the channels the user
 * picked as active can, and only once those picks fit the plan; until then publishing waits for a choice.
 */
function publishableOf(rows: ChannelRow[], limit: number | null) {
  const connected = rows.length;
  const over = limit !== null && connected > limit;
  const picked = rows.filter((r) => r.active);
  const choiceFits = limit === null || picked.length <= limit;
  const publishable = new Set(
    (over ? (choiceFits ? picked : []) : rows).filter((r) => r.status === "connected").map((r) => r.id),
  );
  return {
    connected,
    atLimit: limit !== null && connected >= limit,
    overLimit: over,
    mustChoose: over && !choiceFits,
    publishable,
  };
}

export async function listChannels(userId: string) {
  const { db } = await runtime();
  const [rows, allowance] = await Promise.all([
    db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.ownerId, userId))
      .orderBy(desc(schema.channels.updatedAt)),
    channelAllowance(userId, db),
  ]);
  // Never send the encrypted token (or anything derived from it) to the browser.
  return rows
    .filter((r) => r.status !== "disconnected")
    .map((r) => ({
      id: r.id,
      platform: r.platform,
      title: r.title,
      avatarUrl: r.avatarUrl,
      status: r.status,
      active: r.active,
      /** False while the user is over their plan's channel limit and hasn't kept this one (E1-04). */
      publishable: r.platform === "youtube" ? allowance.publishable.has(r.id) : r.status === "connected",
    }));
}
export type ChannelView = Awaited<ReturnType<typeof listChannels>>[number];

/** Publishing refuses a channel the plan doesn't currently cover (E1-04). */
export async function assertChannelPublishable(userId: string, channelId: string) {
  const a = await channelAllowance(userId);
  if (a.publishable.has(channelId)) return;
  if (a.overLimit) {
    throw new UserError(
      a.mustChoose
        ? `Your ${a.planName} plan includes ${a.limit} channel${a.limit === 1 ? "" : "s"}. Choose which channels stay active in Channels to keep publishing.`
        : `This channel is paused: your ${a.planName} plan includes ${a.limit} channel${a.limit === 1 ? "" : "s"}. Make it active in Channels, or upgrade.`,
    );
  }
}

const limitMessage = (a: ChannelAllowance) =>
  `Your ${a.planName} plan includes ${a.limit} channel${a.limit === 1 ? "" : "s"}. Upgrade on the Billing page, or disconnect one, to connect another.`;

/**
 * After a downgrade: keep `channelIds` active (at most the plan's limit) and pause the rest. The paused channels
 * stay connected, so upgrading again brings them straight back.
 */
export async function chooseActiveChannels(userId: string, input: unknown) {
  const ids = z.array(z.string().min(1)).min(1, "Pick at least one channel.").parse(input);
  const { db } = await runtime();
  const a = await channelAllowance(userId, db);
  if (a.limit !== null && ids.length > a.limit) {
    throw new UserError(
      `Your ${a.planName} plan includes ${a.limit} channel${a.limit === 1 ? "" : "s"}; pick at most ${a.limit}.`,
    );
  }
  const mine = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(limitedChannels(userId));
  const owned = new Set(mine.map((r) => r.id));
  if (!ids.every((id) => owned.has(id))) throw new UserError("Channel not found");
  const now = new Date().toISOString();
  await db.update(schema.channels).set({ active: false, updatedAt: now }).where(limitedChannels(userId));
  await db
    .update(schema.channels)
    .set({ active: true, updatedAt: now })
    .where(and(eq(schema.channels.ownerId, userId), inArray(schema.channels.id, ids)));
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "channels.active_chosen",
    subjectId: userId,
    data: { active: ids, paused: [...owned].filter((id) => !ids.includes(id)), limit: a.limit },
  });
}

export async function youtubeConfigured() {
  return Boolean((await runtime()).youtube);
}

/** A fresh OAuth state value; the route stores it in an httpOnly cookie and compares on callback. */
export async function startYouTubeConnect(userId: string): Promise<{ url: string; state: string }> {
  const { youtube } = await runtime();
  if (!youtube) throw new UserError("YouTube publishing isn't set up on this server yet.");
  // Reconnecting an expired channel is always fine (the callback re-checks for new ones).
  const a = await channelAllowance(userId);
  // So is reconnecting a channel connected before stats were added, to grant read-only analytics (E10-01).
  const reconnecting =
    (await listChannels(userId)).some((c) => c.status === "needs_reconnect") ||
    (await channelsMissingAnalytics((await runtime()).db, userId)).length > 0;
  if (a.atLimit && !reconnecting) throw new UserError(limitMessage(a));
  const state = randomBytes(24).toString("base64url");
  return { url: youtube.authUrl(state), state };
}

export async function finishYouTubeConnect(userId: string, code: string) {
  const rt = await runtime();
  if (!rt.youtube) throw new UserError("YouTube publishing isn't set up on this server yet.");
  const a = await channelAllowance(userId, rt.db);
  let channelId: string;
  try {
    channelId = await connectYouTubeChannel(rt.db, rt.box, rt.youtube, userId, code, {
      maxChannels: a.limit ?? undefined,
    });
  } catch (e) {
    if (e instanceof ChannelLimitError) throw new UserError(limitMessage(a));
    throw e;
  }
  // Backfill the last 28 days of stats for Shorts already on the channel (E10-01). Best effort.
  try {
    await enqueueAnalytics(rt.jobs, { id: channelId, ownerId: userId }, "connect", `connect:${Date.now()}`);
  } catch (e) {
    console.error("analytics backfill not queued", e);
  }
  return channelId;
}

export async function disconnect(userId: string, channelId: string) {
  const rt = await runtime();
  const ch = await rt.db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, userId)),
  });
  if (!ch) throw new UserError("Channel not found");
  await disconnectChannel(
    rt.db,
    rt.box,
    ch.platform === "youtube" ? rt.youtube : undefined,
    userId,
    channelId,
  );
}

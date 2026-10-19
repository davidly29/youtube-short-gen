import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, schema } from "@shortloop/db";
import { connectYouTubeChannel, disconnectChannel } from "@shortloop/worker";
import { UserError } from "./errors";
import { runtime } from "./runtime";

/** httpOnly cookie holding the OAuth state between /start and /callback. */
export const STATE_COOKIE = "yt_oauth_state";

export async function listChannels(userId: string) {
  const { db } = await runtime();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.ownerId, userId))
    .orderBy(desc(schema.channels.updatedAt));
  // Never send the encrypted token (or anything derived from it) to the browser.
  return rows
    .filter((r) => r.status !== "disconnected")
    .map((r) => ({
      id: r.id,
      platform: r.platform,
      title: r.title,
      avatarUrl: r.avatarUrl,
      status: r.status,
    }));
}
export type ChannelView = Awaited<ReturnType<typeof listChannels>>[number];

export async function youtubeConfigured() {
  return Boolean((await runtime()).youtube);
}

/** A fresh OAuth state value; the route stores it in an httpOnly cookie and compares on callback. */
export async function startYouTubeConnect(): Promise<{ url: string; state: string }> {
  const { youtube } = await runtime();
  if (!youtube) throw new UserError("YouTube publishing isn't set up on this server yet.");
  const state = randomBytes(24).toString("base64url");
  return { url: youtube.authUrl(state), state };
}

export async function finishYouTubeConnect(userId: string, code: string) {
  const rt = await runtime();
  if (!rt.youtube) throw new UserError("YouTube publishing isn't set up on this server yet.");
  return connectYouTubeChannel(rt.db, rt.box, rt.youtube, userId, code);
}

export async function disconnect(userId: string, channelId: string) {
  const rt = await runtime();
  const ch = await rt.db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, userId)),
  });
  if (!ch) throw new UserError("Channel not found");
  await disconnectChannel(rt.db, rt.box, rt.youtube, userId, channelId);
}

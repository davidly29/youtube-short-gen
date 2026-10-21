import { randomUUID } from "node:crypto";
import { and, eq, ne, schema, sql, type Db } from "@shortloop/db";
import { ReconnectRequired, type SecretBox, type YouTubeClient } from "@shortloop/providers";

export const channelAad = (ownerId: string, channelId: string) =>
  `channel_refresh_token:${ownerId}:${channelId}`;

export class ChannelError extends Error {}

/** Connecting another channel would go over the plan's channel limit (E1-04). */
export class ChannelLimitError extends ChannelError {
  constructor(readonly limit: number) {
    super(
      `Your plan includes ${limit} channel${limit === 1 ? "" : "s"}. Upgrade, or disconnect one, to connect another.`,
    );
  }
}

/** Channels that count towards the plan limit: everything not disconnected (needs_reconnect still counts). */
export async function countConnectedChannels(db: Db, ownerId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.channels)
    .where(and(eq(schema.channels.ownerId, ownerId), ne(schema.channels.status, "disconnected")));
  return row?.n ?? 0;
}

/**
 * OAuth callback: exchange the code, look up the user's channel, and store the refresh token encrypted.
 * Reconnecting the same channel replaces the token and clears `needs_reconnect`. A channel that isn't connected
 * yet is refused (and the grant revoked) when the user already holds `opts.maxChannels` channels.
 */
export async function connectYouTubeChannel(
  db: Db,
  box: SecretBox,
  yt: YouTubeClient,
  ownerId: string,
  code: string,
  opts: { maxChannels?: number } = {},
) {
  const grant = await yt.exchangeCode(code);
  const ch = await yt.myChannel(grant.accessToken);
  const existing = await db.query.channels.findFirst({
    where: and(eq(schema.channels.platform, "youtube"), eq(schema.channels.externalId, ch.id)),
  });
  if (existing && existing.ownerId !== ownerId) {
    await yt.revoke(grant.refreshToken);
    throw new ChannelError("That channel is already connected to another ShortLoop account.");
  }
  const adding = !existing || existing.status === "disconnected";
  if (adding && opts.maxChannels !== undefined) {
    if ((await countConnectedChannels(db, ownerId)) >= opts.maxChannels) {
      await yt.revoke(grant.refreshToken);
      throw new ChannelLimitError(opts.maxChannels);
    }
  }
  const id = existing?.id ?? `ch_${randomUUID()}`;
  const values = {
    title: ch.title,
    avatarUrl: ch.avatarUrl ?? null,
    secret: box.seal(grant.refreshToken, channelAad(ownerId, id)),
    scopes: grant.scopes.join(" "),
    status: "connected" as const,
    // A newly added channel starts active; a reconnect keeps the user's earlier choice.
    ...(adding ? { active: true } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (existing) await db.update(schema.channels).set(values).where(eq(schema.channels.id, id));
  else
    await db
      .insert(schema.channels)
      .values({ id, ownerId, platform: "youtube", externalId: ch.id, ...values });
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "channel.connected",
    subjectId: id,
    data: { platform: "youtube", externalId: ch.id, title: ch.title, scopes: grant.scopes },
  });
  return id;
}

/** A fresh access token for publishing. An expired grant flags the channel so the UI asks to reconnect. */
export async function channelAccessToken(
  db: Db,
  box: SecretBox,
  yt: YouTubeClient,
  channelId: string,
): Promise<string> {
  const ch = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) });
  if (!ch || ch.status === "disconnected" || !ch.secret)
    throw new ReconnectRequired("This channel isn't connected.");
  if (ch.status === "needs_reconnect") throw new ReconnectRequired();
  let refresh: string;
  try {
    refresh = box.open(ch.secret, channelAad(ch.ownerId, ch.id));
  } catch {
    await markNeedsReconnect(db, ch.ownerId, ch.id, "token unreadable");
    throw new ReconnectRequired();
  }
  try {
    return await yt.accessToken(refresh);
  } catch (e) {
    if (e instanceof ReconnectRequired)
      await markNeedsReconnect(db, ch.ownerId, ch.id, "grant expired or revoked");
    throw e;
  }
}

async function markNeedsReconnect(db: Db, ownerId: string, channelId: string, reason: string) {
  await db
    .update(schema.channels)
    .set({ status: "needs_reconnect", updatedAt: new Date().toISOString() })
    .where(eq(schema.channels.id, channelId));
  await db
    .insert(schema.auditEvents)
    .values({ ownerId, type: "channel.needs_reconnect", subjectId: channelId, data: { reason } });
}

/** Revoke our access at Google and forget the token. The row stays so publish history keeps its channel. */
export async function disconnectChannel(
  db: Db,
  box: SecretBox,
  yt: YouTubeClient | undefined,
  ownerId: string,
  channelId: string,
) {
  const ch = await db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, ownerId)),
  });
  if (!ch) throw new ChannelError("Channel not found");
  if (ch.secret && yt) {
    try {
      await yt.revoke(box.open(ch.secret, channelAad(ownerId, ch.id)));
    } catch {
      // already invalid: nothing left to revoke
    }
  }
  await db
    .update(schema.channels)
    .set({ status: "disconnected", secret: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.channels.id, channelId));
  await db
    .insert(schema.auditEvents)
    .values({ ownerId, type: "channel.disconnected", subjectId: channelId, data: {} });
}

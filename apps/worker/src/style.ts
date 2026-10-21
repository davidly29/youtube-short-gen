import { ChannelStyle, StyleProfile } from "@shortloop/contracts";
import { and, eq, schema, type Db } from "@shortloop/db";
import { NotEnoughVideosError, profileFromVideos } from "@shortloop/pipeline";
import type { SecretBox, YouTubeClient } from "@shortloop/providers";
import { channelAccessToken } from "./channels";

export class StyleError extends Error {}

/** How many recent uploads we read: one page of the uploads playlist (3 quota units in total). */
const VIDEOS_TO_READ = 50;

async function ownChannel(db: Db, ownerId: string, channelId: string) {
  const ch = await db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, ownerId)),
  });
  if (!ch || ch.status === "disconnected") throw new StyleError("Channel not found");
  return ch;
}

function toChannelStyle(row: typeof schema.styleProfiles.$inferSelect): ChannelStyle {
  return ChannelStyle.parse({
    channelId: row.channelId,
    profile: row.profile,
    sourceVideoCount: row.sourceVideoCount,
    enabled: row.enabled,
    builtAt: new Date(row.builtAt).toISOString(),
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : undefined,
  });
}

/**
 * Learn a channel's voice from the creator's own public uploads (titles and descriptions, read with
 * the channel's own OAuth grant; no media is fetched). Rebuilding replaces the learned fields but keeps
 * the creator's banned phrases and the on/off switch. No credits: it makes no AI calls.
 */
export async function buildStyleProfile(
  db: Db,
  box: SecretBox,
  yt: YouTubeClient,
  ownerId: string,
  channelId: string,
): Promise<ChannelStyle> {
  const ch = await ownChannel(db, ownerId, channelId);
  if (ch.platform !== "youtube") throw new StyleError("Channel voice is available for YouTube channels.");
  const token = await channelAccessToken(db, box, yt, channelId);
  const videos = (await yt.myVideos(token, VIDEOS_TO_READ)).filter((v) => v.privacyStatus === "public");
  let learned: StyleProfile;
  try {
    learned = profileFromVideos(videos);
  } catch (e) {
    if (e instanceof NotEnoughVideosError) throw new StyleError(e.message);
    throw e;
  }
  const prev = await db.query.styleProfiles.findFirst({
    where: eq(schema.styleProfiles.channelId, channelId),
  });
  const profile = StyleProfile.parse({
    ...learned,
    bannedPhrases: [...new Set([...(prev?.profile.bannedPhrases ?? []), ...learned.bannedPhrases])].slice(
      0,
      40,
    ),
  });
  const values = {
    profile,
    sourceVideoCount: videos.length,
    builtAt: new Date().toISOString(),
    editedAt: null,
  };
  const [row] = await db
    .insert(schema.styleProfiles)
    .values({ channelId, ownerId, ...values })
    .onConflictDoUpdate({ target: schema.styleProfiles.channelId, set: values })
    .returning();
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "style_profile.built",
    subjectId: channelId,
    data: { sourceVideoCount: videos.length },
  });
  if (!row) throw new StyleError("Couldn't save the channel voice");
  return toChannelStyle(row);
}

export async function getChannelStyle(
  db: Db,
  ownerId: string,
  channelId: string,
): Promise<ChannelStyle | undefined> {
  const row = await db.query.styleProfiles.findFirst({
    where: and(eq(schema.styleProfiles.channelId, channelId), eq(schema.styleProfiles.ownerId, ownerId)),
  });
  return row ? toChannelStyle(row) : undefined;
}

/** The creator's edits from Settings: any profile field, and the on/off switch. */
export async function updateChannelStyle(
  db: Db,
  ownerId: string,
  channelId: string,
  patch: { profile?: StyleProfile; enabled?: boolean },
): Promise<ChannelStyle> {
  await ownChannel(db, ownerId, channelId);
  const current = await getChannelStyle(db, ownerId, channelId);
  if (!current) throw new StyleError("Build the channel voice first");
  const profile = patch.profile ? StyleProfile.parse(patch.profile) : undefined;
  const [row] = await db
    .update(schema.styleProfiles)
    .set({
      ...(profile ? { profile, editedAt: new Date().toISOString() } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    })
    .where(and(eq(schema.styleProfiles.channelId, channelId), eq(schema.styleProfiles.ownerId, ownerId)))
    .returning();
  if (!row) throw new StyleError("Channel not found");
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "style_profile.edited",
    subjectId: channelId,
    data: { fields: profile ? Object.keys(profile) : [], enabled: patch.enabled },
  });
  return toChannelStyle(row);
}

/** The profile a script for this owner should use: only an enabled one on a channel they still have. */
export async function styleForScript(
  db: Db,
  ownerId: string,
  channelId: string | undefined,
): Promise<StyleProfile | undefined> {
  if (!channelId) return undefined;
  const ch = await db.query.channels.findFirst({
    where: and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, ownerId)),
  });
  if (!ch || ch.status === "disconnected") return undefined;
  const style = await getChannelStyle(db, ownerId, channelId);
  return style?.enabled ? style.profile : undefined;
}

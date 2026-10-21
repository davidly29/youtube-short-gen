import "server-only";
import { StyleProfile, type ChannelStyle } from "@shortloop/contracts";
import { and, desc, eq, ne, schema } from "@shortloop/db";
import { ReconnectRequired } from "@shortloop/providers";
import { buildStyleProfile, getChannelStyle, StyleError, updateChannelStyle } from "@shortloop/worker";
import { z } from "zod";
import { UserError } from "./errors";
import { runtime } from "./runtime";

export interface ChannelVoice {
  channel: { id: string; title: string; status: string };
  style?: ChannelStyle;
}

/** Each of the user's YouTube channels with its voice profile, if one has been built (E4-03). */
export async function listChannelVoices(userId: string): Promise<ChannelVoice[]> {
  const { db } = await runtime();
  const channels = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.ownerId, userId),
        eq(schema.channels.platform, "youtube"),
        ne(schema.channels.status, "disconnected"),
      ),
    )
    .orderBy(desc(schema.channels.updatedAt));
  return Promise.all(
    channels.map(async (c) => ({
      channel: { id: c.id, title: c.title, status: c.status },
      style: await getChannelStyle(db, userId, c.id),
    })),
  );
}

/** Channels whose voice the New Short form can offer: built and switched on. */
export async function voiceOptions(userId: string): Promise<{ id: string; title: string }[]> {
  return (await listChannelVoices(userId))
    .filter((v) => v.style?.enabled)
    .map((v) => ({ id: v.channel.id, title: v.channel.title }));
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StyleError) throw new UserError(e.message);
    if (e instanceof ReconnectRequired) throw new UserError(e.message);
    throw e;
  }
}

/** Read the creator's own uploads and (re)build the channel's voice. */
export async function buildChannelVoice(userId: string, channelId: string): Promise<ChannelStyle> {
  const rt = await runtime();
  if (!rt.youtube) throw new UserError("YouTube isn't set up on this server yet.");
  const yt = rt.youtube;
  return run(() => buildStyleProfile(rt.db, rt.box, yt, userId, channelId));
}

/** A textarea as a list: one item per line (or comma-separated, for vocabulary). */
const list = (maxChars: number, sep: RegExp = /\n/) =>
  z
    .string()
    .max(maxChars, "That list is too long")
    .transform((s) =>
      s
        .split(sep)
        .map((x) => x.trim())
        .filter(Boolean),
    );

/** The Settings form. Item limits are enforced by the `StyleProfile` contract. */
export const VoiceForm = z.object({
  vocabulary: list(3000, /\n|,/),
  sentenceLength: z.coerce
    .number()
    .min(3, "Sentence length is 3–40 words")
    .max(40, "Sentence length is 3–40 words"),
  hookPatterns: list(2000),
  bannedPhrases: list(6000),
  examples: list(2000),
});

export async function saveChannelVoice(
  userId: string,
  channelId: string,
  form: z.input<typeof VoiceForm>,
): Promise<ChannelStyle> {
  const parsed = VoiceForm.parse(form);
  const profile = StyleProfile.safeParse(parsed);
  if (!profile.success)
    throw new UserError(
      "That's too much for one profile: up to 60 words, 12 hook patterns, 40 banned phrases and 8 examples.",
    );
  const { db } = await runtime();
  return run(() => updateChannelStyle(db, userId, channelId, { profile: profile.data }));
}

export async function setChannelVoiceEnabled(userId: string, channelId: string, enabled: boolean) {
  const { db } = await runtime();
  return run(() => updateChannelStyle(db, userId, channelId, { enabled }));
}

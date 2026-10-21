import { z } from "zod";
import { IsoDateTime } from "./common";

/** A profile needs at least this many of the creator's own published videos (E4-03). */
export const MIN_STYLE_VIDEOS = 10;

const phrase = z.string().trim().min(1).max(120);

/**
 * How a channel writes, learned from the creator's own published videos (E4-03) and editable by them.
 * Fed into script generation so scripts sound like the creator, not like a generic AI.
 */
export const StyleProfile = z.object({
  /** Words the creator uses often and distinctively (no stopwords), most frequent first. */
  vocabulary: z.array(z.string().trim().min(1).max(40)).max(60),
  /** Average words per sentence in their titles, descriptions and transcripts. */
  sentenceLength: z.number().min(3).max(40),
  /** Openers they use for titles, e.g. "Why the …?", "{n} things …". */
  hookPatterns: z.array(phrase).max(12),
  /** Phrases scripts must never use (the creator's own pet hates, plus generic AI clichés). */
  bannedPhrases: z.array(phrase).max(40),
  /** A few of their own titles, verbatim, as tone references. */
  examples: z.array(z.string().trim().min(1).max(200)).max(8),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

/** A channel's stored profile, as the settings page shows it. */
export const ChannelStyle = z.object({
  channelId: z.string().min(1),
  profile: StyleProfile,
  /** How many of the creator's videos it was built from (≥ MIN_STYLE_VIDEOS). */
  sourceVideoCount: z.number().int().min(MIN_STYLE_VIDEOS),
  /** Off: scripts ignore the profile without losing it. */
  enabled: z.boolean(),
  builtAt: IsoDateTime,
  /** Set once the creator has edited the profile by hand. */
  editedAt: IsoDateTime.optional(),
});
export type ChannelStyle = z.infer<typeof ChannelStyle>;

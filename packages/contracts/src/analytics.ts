import { z } from "zod";
import { Id } from "./common";
import { FormatSlug } from "./brief";

/** `YYYY-MM-DD`: the day a metric row covers (as YouTube Analytics reports it). */
export const MetricDate = z.iso.date();

/**
 * One published Short's results for one day (E10-01). Upserted by (publishId, date), so re-ingesting a
 * day replaces its numbers (YouTube revises recent days for ~48 h). `avgViewPct` can exceed 100 on Shorts
 * because loops count. `swipeAwayRate` is optional: YouTube's API doesn't report it.
 */
export const ShortMetrics = z.object({
  publishId: Id,
  date: MetricDate,
  views: z.number().int().nonnegative(),
  avgViewPct: z.number().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  subsGained: z.number().int(),
  swipeAwayRate: z.number().min(0).max(1).optional(),
});
export type ShortMetrics = z.infer<typeof ShortMetrics>;

/** Totals for the dashboard card: views summed, retention weighted by views. */
export const ShortPerformance = z.object({
  publishId: Id,
  projectId: Id.optional(),
  title: z.string(),
  channelTitle: z.string(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  days: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  avgViewPct: z.number().nonnegative().optional(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  subsGained: z.number().int(),
});
export type ShortPerformance = z.infer<typeof ShortPerformance>;

/** How a hook opens (E10-02): the unit the recommender (E10-03) learns over. */
export const HookType = z.enum(["question", "number", "how_why", "contrarian", "statement"]);
export type HookType = z.infer<typeof HookType>;

/** Share of on-screen video time by where the footage came from; sums to 1 (or all 0 with no clips). */
export const VisualMix = z.object({
  own: z.number().min(0).max(1),
  stock: z.number().min(0).max(1),
  ai: z.number().min(0).max(1),
});
export type VisualMix = z.infer<typeof VisualMix>;

/**
 * Every choice we made for one published Short (E10-02). `format` is the brief format the Short was made
 * from, or `custom` for a typed topic; `topicVelocity` is null when the Short didn't come from a trend
 * (or came from a brief stored before velocities were kept). `postHour` is the UTC hour it went live.
 */
export const ShortFeatures = z.object({
  hookType: HookType,
  hookWords: z.number().int().nonnegative(),
  durationS: z.number().nonnegative(),
  beats: z.number().int().nonnegative(),
  captionStyle: z.string(),
  voiceId: z.string(),
  visualMix: VisualMix,
  format: z.union([FormatSlug, z.literal("custom")]),
  topicVelocity: z.number().positive().nullable(),
  postHour: z.number().int().min(0).max(23),
});
export type ShortFeatures = z.infer<typeof ShortFeatures>;

/** Short lengths the script generator targets (E4-01). */
export const TargetSeconds = z.union([z.literal(30), z.literal(45), z.literal(60)]);
export type TargetSeconds = z.infer<typeof TargetSeconds>;

/** The parts of a recommendation (E10-03), each with its own reason and each overridable. */
export const RecommendationField = z.enum(["preferredFormats", "hookPatterns", "targetSeconds", "postHour"]);
export type RecommendationField = z.infer<typeof RecommendationField>;

/**
 * Why one part of a recommendation is what it is, in words a creator can read. `source` says where the
 * evidence came from: the channel's own Shorts, the shared prior (opted-in channels), a default (no data
 * yet) or the user's own override. `shorts` counts the channel's own Shorts behind it; `lift` is the
 * expected avg view % relative to the channel's average (1.2 = 20% better), when there is one.
 */
export const RecommendationReason = z.object({
  field: RecommendationField,
  source: z.enum(["channel", "shared_prior", "default", "user"]),
  text: z.string().min(1).max(300),
  shorts: z.number().int().nonnegative(),
  lift: z.number().nonnegative().optional(),
});
export type RecommendationReason = z.infer<typeof RecommendationReason>;

/**
 * What the brief and script generator should favour for one channel (E10-03): formats and hook types in
 * order of preference, a target length and a UTC posting hour, with one reason per field. A suggestion
 * only: nothing is ever published without the user's approval.
 */
export const Recommendation = z.object({
  channelId: Id,
  preferredFormats: z.array(FormatSlug).min(1).max(4),
  hookPatterns: z.array(HookType).min(1).max(5),
  targetSeconds: TargetSeconds,
  postHour: z.number().int().min(0).max(23),
  why: z.array(RecommendationReason).length(4),
  basedOn: z.object({
    shorts: z.number().int().nonnegative(),
    priorShorts: z.number().int().nonnegative(),
    priorChannels: z.number().int().nonnegative(),
  }),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** A user's choices that replace parts of a recommendation; `note` is shown as the reason. */
export const RecommendationOverride = z.object({
  preferredFormats: z.array(FormatSlug).min(1).max(4).optional(),
  hookPatterns: z.array(HookType).min(1).max(5).optional(),
  targetSeconds: TargetSeconds.optional(),
  postHour: z.number().int().min(0).max(23).optional(),
  note: z.string().min(1).max(200).optional(),
});
export type RecommendationOverride = z.infer<typeof RecommendationOverride>;

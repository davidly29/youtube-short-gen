import { z } from "zod";
import { Id, IsoDateTime } from "./common";

export const Platform = z.enum(["youtube", "tiktok", "instagram"]);
export const Privacy = z.enum(["public", "unlisted", "private"]);

export const PublishRequest = z.object({
  platform: Platform,
  accountId: Id,
  videoAssetId: Id,
  /** YouTube's limit; the strictest of the three platforms. */
  title: z.string().min(1).max(100),
  description: z.string().max(5000),
  tags: z.array(z.string().min(1)).max(30),
  privacy: Privacy,
  scheduledAt: IsoDateTime.optional(),
  /** Platform "altered or synthetic content" / AI-generated label. */
  aiDisclosure: z.boolean(),
});
export type PublishRequest = z.infer<typeof PublishRequest>;

/** Lifecycle of one upload to one channel. `scheduled_next_window`: daily quota used up, retried automatically. */
export const PublishStatus = z.enum([
  "queued",
  "uploading",
  "scheduled",
  "scheduled_next_window",
  "published",
  "failed",
]);
export type PublishStatus = z.infer<typeof PublishStatus>;

/** A channel's health: `needs_reconnect` when its OAuth grant expired or was revoked; `disconnected` by the user (row kept for publish history). */
export const ChannelStatus = z.enum(["connected", "needs_reconnect", "disconnected"]);
export type ChannelStatus = z.infer<typeof ChannelStatus>;

/** Uploads to one channel never repeat: one publish per (rendered video, channel). */
export const publishIdempotencyKey = (videoAssetId: string, channelId: string) =>
  `publish:${videoAssetId}:${channelId}`;

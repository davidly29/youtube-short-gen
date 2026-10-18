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

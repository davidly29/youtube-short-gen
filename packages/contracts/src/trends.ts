import { z } from "zod";
import { Id, IsoDateTime } from "./common";

/**
 * Where a trend signal came from. All four sources are listed now so later collectors
 * (RSS #75, Google Trends #76) need no contract change. Metadata only: no source ever yields media.
 */
export const TrendSource = z.enum(["youtube_popular", "wikipedia", "rss", "google_trends"]);
export type TrendSource = z.infer<typeof TrendSource>;

/** ISO 3166-1 alpha-2 region (`IE`, `GB`, `US`), or `global` for region-less sources such as niche RSS feeds. */
export const TrendRegion = z.union([z.string().regex(/^[A-Z]{2}$/), z.literal("global")]);
export type TrendRegion = z.infer<typeof TrendRegion>;

/** One raw observation that something is rising (E3-01). Kept for 30 days, then pruned. */
export const TrendSignal = z.object({
  id: Id,
  source: TrendSource,
  region: TrendRegion,
  /** YouTube video category id (e.g. `28` Science & Technology) when the source is category-scoped. */
  categoryId: z.string().regex(/^\d+$/).optional(),
  /** ShortLoop niche (`tech`, `science`, ...) when the source is niche-scoped, e.g. an RSS feed. */
  niche: z.string().min(1).max(40).optional(),
  title: z.string().min(1).max(500),
  /** Link to the item for humans and citations. Never fetched by collectors. */
  url: z.url().optional(),
  keywords: z.array(z.string().min(1)).max(30),
  /** Source-specific strength: views for YouTube/Wikipedia, 1 per RSS item. */
  metric: z.number().nonnegative(),
  observedAt: IsoDateTime,
});
export type TrendSignal = z.infer<typeof TrendSignal>;

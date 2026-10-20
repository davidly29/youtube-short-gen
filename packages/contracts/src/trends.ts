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

/** A ShortLoop niche id: lower-case slug (`tech`, `science`, `finance`, `history`). */
export const NicheId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type NicheId = z.infer<typeof NicheId>;

/**
 * A content niche a channel publishes in (E3-02). Signals belong to a niche when their YouTube
 * category is listed, their feed is tagged with the niche, or they share at least one keyword.
 */
export const Niche = z.object({
  id: NicheId,
  name: z.string().min(1).max(60),
  keywords: z.array(z.string().min(1).max(40)).min(1).max(50),
  categoryIds: z.array(z.string().regex(/^\d+$/)).max(10),
});
export type Niche = z.infer<typeof Niche>;

/** A signal that backs a topic, kept for citations and "why now" (never fetched). */
export const TopicSource = z.object({
  url: z.url().optional(),
  title: z.string().min(1).max(500),
  source: TrendSource,
});
export type TopicSource = z.infer<typeof TopicSource>;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A cluster of signals with momentum in one niche (E3-02). `id` is a stable hash of its top keywords. */
export const Topic = z.object({
  id: Id,
  nicheId: NicheId,
  /** 2–6 title-cased keywords. */
  label: z
    .string()
    .min(1)
    .max(120)
    .refine((s) => wordCount(s) >= 2 && wordCount(s) <= 6, "label must have 2–6 words"),
  keywords: z.array(z.string().min(1)).min(1).max(20),
  /** Last-24 h activity over the daily mean of the previous 7 days (+1 smoothing); > 0. */
  velocity: z.number().positive(),
  /** Signals observed in the last 24 h (shown in the brief's "why now"). */
  signals24h: z.number().int().nonnegative(),
  sources: z.array(TopicSource).min(1).max(10),
  firstSeen: IsoDateTime,
});
export type Topic = z.infer<typeof Topic>;

/**
 * The niches a channel can pick (owner-reviewed list). YouTube categories: 25 News & Politics,
 * 27 Education, 28 Science & Technology.
 */
export const DEFAULT_NICHES: readonly Niche[] = [
  {
    id: "tech",
    name: "Tech",
    categoryIds: ["28"],
    keywords: [
      "ai",
      "apple",
      "android",
      "iphone",
      "google",
      "microsoft",
      "openai",
      "chip",
      "gpu",
      "nvidia",
      "software",
      "startup",
      "robot",
      "smartphone",
      "laptop",
      "gadget",
      "cybersecurity",
      "app",
    ],
  },
  {
    id: "science",
    name: "Science",
    categoryIds: ["28"],
    keywords: [
      "science",
      "space",
      "nasa",
      "physics",
      "biology",
      "chemistry",
      "planet",
      "asteroid",
      "telescope",
      "climate",
      "fossil",
      "dinosaur",
      "quantum",
      "fusion",
      "species",
      "brain",
      "study",
      "researchers",
    ],
  },
  {
    id: "finance",
    name: "Finance",
    categoryIds: ["27", "25"],
    keywords: [
      "money",
      "stock",
      "stocks",
      "market",
      "economy",
      "inflation",
      "interest",
      "rates",
      "bitcoin",
      "crypto",
      "investing",
      "mortgage",
      "tax",
      "bank",
      "earnings",
      "recession",
    ],
  },
  {
    id: "history",
    name: "History",
    categoryIds: ["27"],
    keywords: [
      "history",
      "ancient",
      "empire",
      "war",
      "medieval",
      "roman",
      "egypt",
      "archaeology",
      "archaeologists",
      "castle",
      "king",
      "queen",
      "dynasty",
      "civilization",
      "historic",
      "shipwreck",
    ],
  },
];

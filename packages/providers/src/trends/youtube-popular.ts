import { TrendSignal } from "@shortloop/contracts";
import { extractKeywords, type FetchLike, type TrendCollector, trendSignalId } from "./collector";

/** The only endpoint this collector calls (YouTube Data API v3, metadata). */
export const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";

/** Daily quota budget for trend collection per region (business plan E3-01). */
export const YOUTUBE_TRENDS_DAILY_QUOTA = 500;
/** `videos.list` costs 1 quota unit per call. */
const UNITS_PER_CALL = 1;

/** Units a region uses per day: one `videos.list` call per category per run. */
export const youtubeDailyQuota = (categoryCount: number, runsPerDay = 24): number =>
  categoryCount * UNITS_PER_CALL * runsPerDay;

export class QuotaBudgetError extends Error {
  constructor(units: number) {
    super(
      `YouTube trend collection would use ${units} quota units/day per region (budget ${YOUTUBE_TRENDS_DAILY_QUOTA}); ` +
        "reduce TRENDS_CATEGORIES or the run frequency",
    );
    this.name = "QuotaBudgetError";
  }
}

interface VideosListResponse {
  items?: {
    id: string;
    snippet?: { title?: string; tags?: string[]; categoryId?: string };
    statistics?: { viewCount?: string };
  }[];
}

export interface YouTubePopularOptions {
  apiKey: string;
  fetch: FetchLike;
  /** How often the hourly job runs per day (for the quota check). Default 24. */
  runsPerDay?: number;
  /** Videos per category (one page, max 50). Default 25. */
  maxResults?: number;
  now?: () => Date;
}

/**
 * Most-popular videos per region and category via `videos.list?chart=mostPopular` (E3-01).
 * Reads titles, tags and view counts only; thumbnails and the videos themselves are never fetched.
 */
export class YouTubePopularCollector implements TrendCollector {
  readonly source = "youtube_popular" as const;
  readonly scope = "region" as const;
  private readonly runsPerDay: number;
  private readonly maxResults: number;
  private readonly now: () => Date;

  constructor(private readonly opts: YouTubePopularOptions) {
    this.runsPerDay = opts.runsPerDay ?? 24;
    this.maxResults = Math.min(50, Math.max(1, opts.maxResults ?? 25));
    this.now = opts.now ?? (() => new Date());
  }

  /** Throws `QuotaBudgetError` if this many categories, run `runsPerDay` times, would exceed 500 units/day. */
  assertWithinQuota(categoryCount: number): void {
    const units = youtubeDailyQuota(categoryCount, this.runsPerDay);
    if (units > YOUTUBE_TRENDS_DAILY_QUOTA) throw new QuotaBudgetError(units);
  }

  async collect(region: string, categoryIds: readonly string[]): Promise<TrendSignal[]> {
    this.assertWithinQuota(categoryIds.length);
    const observedAt = this.now().toISOString();
    const out: TrendSignal[] = [];
    for (const categoryId of categoryIds) {
      const params = new URLSearchParams({
        part: "snippet,statistics",
        chart: "mostPopular",
        regionCode: region,
        videoCategoryId: categoryId,
        maxResults: String(this.maxResults),
        // Only the fields we use: keeps responses small and makes clear no media URLs are needed.
        fields: "items(id,snippet(title,tags,categoryId),statistics(viewCount))",
        key: this.opts.apiKey,
      });
      const res = await this.opts.fetch(`${YOUTUBE_VIDEOS_ENDPOINT}?${params}`);
      // Some categories have no chart in some regions (videoChartNotFound): skip that category.
      if (res.status === 404 || res.status === 400) {
        console.warn(`youtube trends: no chart for region ${region} category ${categoryId} (${res.status})`);
        continue;
      }
      if (!res.ok) throw new Error(`YouTube videos.list ${res.status}`);
      const data = (await res.json()) as VideosListResponse;
      for (const v of data.items ?? []) {
        const title = v.snippet?.title?.trim();
        if (!title) continue;
        const base = {
          source: this.source,
          region,
          categoryId,
          title: title.slice(0, 500),
          observedAt,
        } as const;
        const parsed = TrendSignal.safeParse({
          ...base,
          id: trendSignalId(base),
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
          keywords: extractKeywords(title, v.snippet?.tags ?? []),
          metric: Number(v.statistics?.viewCount ?? 0) || 0,
        });
        if (parsed.success) out.push(parsed.data);
      }
    }
    return out;
  }
}

import { type FetchLike, type TrendCollector } from "./collector";
import { WikipediaPageviewsCollector } from "./wikipedia";
import { YouTubePopularCollector } from "./youtube-popular";

export { extractKeywords, trendSignalId, type FetchLike, type TrendCollector } from "./collector";
export {
  QuotaBudgetError,
  YOUTUBE_TRENDS_DAILY_QUOTA,
  YOUTUBE_VIDEOS_ENDPOINT,
  YouTubePopularCollector,
  youtubeDailyQuota,
  type YouTubePopularOptions,
} from "./youtube-popular";
export {
  WIKIMEDIA_PAGEVIEWS_ENDPOINT,
  WIKIMEDIA_USER_AGENT,
  WikipediaPageviewsCollector,
  type WikipediaPageviewsOptions,
} from "./wikipedia";
export { FakeTrendCollector } from "./fake";

/**
 * Platform trend collectors from env. Collection is platform-level (free official APIs, no user keys,
 * no credits). Without `YOUTUBE_API_KEY` the YouTube collector is skipped with a warning and the
 * Wikipedia collector still runs.
 */
export function trendCollectorsFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
  warn: (msg: string) => void = console.warn,
): TrendCollector[] {
  const collectors: TrendCollector[] = [];
  if (env.YOUTUBE_API_KEY) {
    collectors.push(new YouTubePopularCollector({ apiKey: env.YOUTUBE_API_KEY, fetch: fetchImpl }));
  } else {
    warn("trends: YOUTUBE_API_KEY is not set, skipping the YouTube most-popular collector");
  }
  collectors.push(new WikipediaPageviewsCollector({ fetch: fetchImpl }));
  return collectors;
}

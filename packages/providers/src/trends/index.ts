import { type FeedConfig, RssCollector } from "./rss";
import feedsJson from "./feeds.json";
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
export { parseFeed, RssCollector, type FeedConfig, type FeedItem, type RssCollectorOptions } from "./rss";
export { FakeTrendCollector } from "./fake";

/** The reviewed niche feed list (owner-reviewed config; see feeds.json). */
export const DEFAULT_FEEDS: readonly FeedConfig[] = feedsJson;

/**
 * Platform trend collectors from env. Collection is platform-level (free official APIs, no user keys,
 * no credits). Without `YOUTUBE_API_KEY` the YouTube collector is skipped with a warning and the
 * Wikipedia and RSS collectors still run.
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
  collectors.push(new RssCollector({ feeds: DEFAULT_FEEDS, fetch: fetchImpl }));
  return collectors;
}

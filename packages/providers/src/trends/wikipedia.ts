import { TrendSignal } from "@shortloop/contracts";
import { extractKeywords, type FetchLike, type TrendCollector, trendSignalId } from "./collector";

/** Wikimedia REST API, pageviews metrics (the only host/path this collector calls). */
export const WIKIMEDIA_PAGEVIEWS_ENDPOINT = "https://wikimedia.org/api/rest_v1/metrics/pageviews";

/** Wikimedia asks API clients to identify themselves with contact details. */
export const WIKIMEDIA_USER_AGENT =
  "ShortLoopTrends/0.1 (https://github.com/davidly29/youtube-short-gen; trend radar, metadata only)";

interface TopPerCountryResponse {
  items?: {
    articles?: { article: string; project: string; views_ceil?: number; views?: number; rank: number }[];
  }[];
}

/** Namespaced pages (Special:, File:, Wikipedia:, ...) and the main page are not topics. */
const NOT_A_TOPIC = /^(Main_Page|Special:|Wikipedia:|File:|Portal:|Help:|Talk:|User:|Template:|Category:|-$)/;

export interface WikipediaPageviewsOptions {
  fetch: FetchLike;
  /** Articles kept per region. Default 50. */
  limit?: number;
  now?: () => Date;
  userAgent?: string;
}

const ymd = (d: Date) => [
  String(d.getUTCFullYear()),
  String(d.getUTCMonth() + 1).padStart(2, "0"),
  String(d.getUTCDate()).padStart(2, "0"),
];

/**
 * Most-viewed Wikipedia articles per country for the latest published day (E3-01), via the
 * Wikimedia `top-per-country` pageviews API. Daily data appears about a day late, so it tries
 * yesterday and then the day before. Signals are stamped with the data's date, so the hourly run
 * re-collecting the same day inserts nothing new.
 */
export class WikipediaPageviewsCollector implements TrendCollector {
  readonly source = "wikipedia" as const;
  readonly scope = "region" as const;
  private readonly now: () => Date;

  constructor(private readonly opts: WikipediaPageviewsOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  async collect(region: string): Promise<TrendSignal[]> {
    const ua = this.opts.userAgent ?? WIKIMEDIA_USER_AGENT;
    for (const daysBack of [1, 2]) {
      const day = new Date(this.now().getTime() - daysBack * 86_400_000);
      const [y, m, d] = ymd(day);
      const url = `${WIKIMEDIA_PAGEVIEWS_ENDPOINT}/top-per-country/${encodeURIComponent(region)}/all-access/${y}/${m}/${d}`;
      const res = await this.opts.fetch(url, {
        headers: { "user-agent": ua, "api-user-agent": ua, accept: "application/json" },
      });
      if (res.status === 404) continue; // that day isn't published yet
      if (!res.ok) throw new Error(`Wikimedia pageviews ${res.status}`);
      const data = (await res.json()) as TopPerCountryResponse;
      const observedAt = `${y}-${m}-${d}T00:00:00.000Z`;
      const articles = (data.items ?? [])
        .flatMap((i) => i.articles ?? [])
        .filter((a) => a.project.endsWith(".wikipedia") && !NOT_A_TOPIC.test(a.article))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, this.opts.limit ?? 50);
      const out: TrendSignal[] = [];
      for (const a of articles) {
        const title = a.article.replace(/_/g, " ").slice(0, 500);
        const base = { source: this.source, region, title, observedAt } as const;
        const parsed = TrendSignal.safeParse({
          ...base,
          id: trendSignalId(base),
          url: `https://${a.project}.org/wiki/${encodeURIComponent(a.article)}`,
          keywords: extractKeywords(title),
          metric: a.views_ceil ?? a.views ?? 0,
        });
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    }
    return [];
  }
}

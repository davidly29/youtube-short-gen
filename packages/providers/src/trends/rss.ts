import { TrendSignal } from "@shortloop/contracts";
import { XMLParser } from "fast-xml-parser";
import { extractKeywords, type FetchLike, type TrendCollector, trendSignalId } from "./collector";

/** One reviewed publisher feed (`feeds.json`). */
export interface FeedConfig {
  niche: string;
  name: string;
  feedUrl: string;
  homepageUrl: string;
}

export interface RssCollectorOptions {
  feeds: readonly FeedConfig[];
  fetch: FetchLike;
  /** Items published longer ago than this are dropped. Default 48 h. */
  maxAgeMs?: number;
  /** Per-feed timeout. Default 10 s. */
  timeoutMs?: number;
  now?: () => Date;
}

/** A parsed feed item before it becomes a signal. */
export interface FeedItem {
  title: string;
  link?: string;
  categories: string[];
  publishedAt?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Never expand entities beyond the XML built-ins (no external/DTD entity tricks).
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ["item", "entry", "category", "link"].includes(name),
});

const text = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return text((v as Record<string, unknown>)["#text"]);
  return undefined;
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

const iso = (v: unknown): string | undefined => {
  const s = text(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Feed titles may carry inline HTML (`type="html"`); keep the words only. */
const plain = (s: string | undefined): string | undefined =>
  s
    ?.replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim() || undefined;

/** Parse RSS 2.0 or Atom XML into items. Enclosures and media elements are ignored entirely. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as { channel?: { item?: unknown[] } } | undefined;
  if (rss?.channel) {
    return asArray(rss.channel.item).flatMap((raw) => {
      const i = raw as Record<string, unknown>;
      const title = plain(text(i.title));
      if (!title) return [];
      return [
        {
          title,
          link: asArray(i.link).map(text).find(Boolean),
          categories: asArray(i.category)
            .map(text)
            .filter((c): c is string => Boolean(c)),
          publishedAt: iso(i.pubDate) ?? iso(i["dc:date"]),
        },
      ];
    });
  }
  const feed = doc.feed as { entry?: unknown[] } | undefined;
  if (feed) {
    return asArray(feed.entry).flatMap((raw) => {
      const e = raw as Record<string, unknown>;
      const title = plain(text(e.title));
      if (!title) return [];
      const links = asArray(e.link) as Record<string, unknown>[];
      const alt =
        links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ??
        links.find((l) => l["@_rel"] !== "enclosure");
      return [
        {
          title,
          link: typeof alt?.["@_href"] === "string" ? alt["@_href"] : undefined,
          categories: (asArray(e.category) as Record<string, unknown>[])
            .map((c) => (typeof c["@_term"] === "string" ? c["@_term"] : text(c)))
            .filter((c): c is string => Boolean(c)),
          publishedAt: iso(e.published) ?? iso(e.updated),
        },
      ];
    });
  }
  throw new Error("not an RSS 2.0 or Atom feed");
}

const httpUrl = (u: string | undefined): string | undefined => {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Niche news as trend signals (E3-01c). Fetches only each feed's `feedUrl` (never enclosures,
 * images or linked articles); a feed that errors or times out is skipped and the rest still count.
 */
export class RssCollector implements TrendCollector {
  readonly source = "rss" as const;
  readonly scope = "global" as const;
  private readonly now: () => Date;

  constructor(private readonly opts: RssCollectorOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  async collect(region: string): Promise<TrendSignal[]> {
    const now = this.now().getTime();
    const maxAge = this.opts.maxAgeMs ?? 48 * 3_600_000;
    const results = await Promise.allSettled(this.opts.feeds.map((f) => this.readFeed(f)));
    const out: TrendSignal[] = [];
    const seen = new Set<string>();
    results.forEach((r, idx) => {
      const feed = this.opts.feeds[idx];
      if (!feed) return;
      if (r.status === "rejected") {
        console.warn(`rss trends: skipped ${feed.name}: ${String(r.reason)}`);
        return;
      }
      for (const item of r.value) {
        if (!item.publishedAt) continue; // can't tell if it's fresh
        const age = now - Date.parse(item.publishedAt);
        if (age > maxAge || age < -3_600_000) continue; // stale, or dated in the future
        const title = item.title.slice(0, 500);
        const base = { source: this.source, region, title, observedAt: item.publishedAt } as const;
        const id = trendSignalId(base);
        if (seen.has(id)) continue;
        const parsed = TrendSignal.safeParse({
          ...base,
          id,
          niche: feed.niche,
          url: httpUrl(item.link),
          keywords: extractKeywords(title, item.categories),
          metric: 1,
        });
        if (parsed.success) {
          seen.add(id);
          out.push(parsed.data);
        }
      }
    });
    return out;
  }

  private async readFeed(feed: FeedConfig): Promise<FeedItem[]> {
    const res = await this.opts.fetch(feed.feedUrl, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text());
  }
}

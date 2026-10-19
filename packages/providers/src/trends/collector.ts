import { createHash } from "node:crypto";
import type { TrendSignal } from "@shortloop/contracts";

/**
 * A trend source (E3-01). Collectors read metadata only (titles, tags, view counts, feed XML):
 * they never fetch a video, audio file, image, enclosure or linked article.
 *
 * `scope: "region"` collectors run once per configured region; `"global"` ones (niche RSS feeds)
 * run once per hour with `region = "global"`.
 */
export interface TrendCollector {
  readonly source: TrendSignal["source"];
  readonly scope: "region" | "global";
  collect(region: string, categoryIds: readonly string[]): Promise<TrendSignal[]>;
}

/** `fetch` is always injected so tests run on fixtures and can prove which URLs are requested. */
export type FetchLike = typeof fetch;

/** Stable id for a signal: same source, region, category and title in the same hour → same id. */
export function trendSignalId(
  s: Pick<TrendSignal, "source" | "region" | "categoryId" | "title" | "observedAt">,
): string {
  const hour = new Date(s.observedAt);
  hour.setUTCMinutes(0, 0, 0);
  const key = [s.source, s.region, s.categoryId ?? "", s.title, hour.toISOString()].join("\u0000");
  return `sig_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can did do does for from get got has have how i if in into is it its " +
    "just me my new no not now of off on one or our out over so than that the their them then there " +
    "these they this to too up us vs was we what when where which who why will with you your " +
    "official video shorts short full episode ep part live update today"
  ).split(" "),
);

/**
 * Keywords from a title plus optional tags/categories: lower-cased words of 3+ letters, stopwords
 * and pure numbers dropped, de-duplicated in first-seen order, at most `max`.
 */
export function extractKeywords(title: string, extra: readonly string[] = [], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    const k = w.toLowerCase().trim();
    if (k.length < 3 || k.length > 40 || /^\d+$/.test(k) || STOPWORDS.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const w of title.split(/[^\p{L}\p{N}'-]+/u)) add(w.replace(/^['-]+|['-]+$/g, ""));
  // Tags and categories are kept whole (multi-word tags are often the best keywords).
  for (const t of extra) add(t.replace(/\s+/g, " "));
  return out.slice(0, max);
}

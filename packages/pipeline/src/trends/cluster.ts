import { createHash } from "node:crypto";
import type { Niche, Topic, TopicSource, TrendSignal } from "@shortloop/contracts";
import { embed as localEmbed } from "../variation";

/** Clusters merge while their average cosine distance is below this (E3-02). */
export const CLUSTER_DISTANCE_THRESHOLD = 0.35;
/** How many topics `clusterTopics` returns per niche. */
export const MAX_TOPICS = 20;
/** Distinct items clustered per call (the strongest are kept); bounds memory at ~25 MB. */
export const MAX_CLUSTER_ITEMS = 2500;
/** Baseline window for velocity, in days before the last 24 h. */
export const BASELINE_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ClusterOptions {
  /** Text embedding; defaults to the local hashed n-gram embedding of the variation guard. */
  embed?: (text: string) => ArrayLike<number>;
  /** Breaks ties between equally close clusters. Same seed, same output. */
  seed?: number;
  /** "Now" for the 24 h / 7-day windows. */
  now: Date;
}

const LABEL_STOPWORDS = new Set(
  (
    "a an and are as at be but by can did do does for from get got has have how i if in into is it its " +
    "just me my new no not now of off on one or our out over so than that the their them then there " +
    "these they this to too up us vs was we what when where which who why will with you your " +
    "official video videos shorts short full episode ep part live update today says said after about " +
    "more most first year years day days week"
  ).split(" "),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a signal belongs to the niche: its YouTube category, its feed's niche tag, or at least one
 * niche keyword in its title or keywords (case-insensitive, whole words).
 */
export function nicheMatcher(niche: Niche): (signal: TrendSignal) => boolean {
  const res = niche.keywords.map(
    (k) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, "iu"),
  );
  return (signal) => {
    if (signal.categoryId && niche.categoryIds.includes(signal.categoryId)) return true;
    if (signal.niche === niche.id) return true;
    const text = `${signal.title} ${signal.keywords.join(" ")}`;
    return res.some((re) => re.test(text));
  };
}

const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** One distinct story (same normalised title) with every time it was observed. */
interface Item {
  key: string;
  title: string;
  url?: string;
  source: TrendSignal["source"];
  keywords: string[];
  observations: { at: number; strength: number }[];
  strength: number;
  rank: string;
}

/** log1p(metric) scaled to 0..1 per source, so YouTube views don't drown pageviews or RSS items. */
function strengths(signals: readonly TrendSignal[]): Map<TrendSignal, number> {
  const max = new Map<string, number>();
  for (const s of signals) max.set(s.source, Math.max(max.get(s.source) ?? 0, Math.log1p(s.metric)));
  return new Map(
    signals.map((s) => {
      const m = max.get(s.source) ?? 0;
      return [s, m > 0 ? Math.log1p(s.metric) / m : 1];
    }),
  );
}

function sparse(v: ArrayLike<number>): { idx: Int32Array; val: Float64Array } {
  const idx: number[] = [];
  const val: number[] = [];
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0;
    if (x !== 0) {
      idx.push(i);
      val.push(x);
      norm += x * x;
    }
  }
  norm = Math.sqrt(norm) || 1;
  return { idx: Int32Array.from(idx), val: Float64Array.from(val, (x) => x / norm) };
}

function sparseCosine(a: { idx: Int32Array; val: Float64Array }, b: { idx: Int32Array; val: Float64Array }) {
  let i = 0;
  let j = 0;
  let s = 0;
  while (i < a.idx.length && j < b.idx.length) {
    const ai = a.idx[i] ?? 0;
    const bj = b.idx[j] ?? 0;
    if (ai === bj) s += (a.val[i++] ?? 0) * (b.val[j++] ?? 0);
    else if (ai < bj) i++;
    else j++;
  }
  return s;
}

/**
 * Average-linkage agglomerative clustering via the nearest-neighbour chain (exact for average
 * linkage, O(n²)). Returns a cluster index per item: merges with distance below `threshold` only.
 * Ties go to the lower index, and items arrive in a seeded order, so `seed` breaks ties.
 */
export function averageLinkage(dist: Float32Array, n: number, threshold: number): number[] {
  const size = new Int32Array(n).fill(1);
  const active = new Uint8Array(n).fill(1);
  const anchor = Array.from({ length: n }, (_, i) => i);
  const merges: { a: number; b: number; d: number }[] = [];
  const at = (i: number, j: number) => dist[i * n + j] ?? Infinity;
  let remaining = n;
  const chain: number[] = [];
  while (remaining > 1) {
    if (chain.length === 0) {
      let first = 0;
      while (!active[first]) first++;
      chain.push(first);
    }
    const top = chain[chain.length - 1] ?? 0;
    const prev = chain.length > 1 ? chain[chain.length - 2] : undefined;
    let best = -1;
    let bestD = Infinity;
    if (prev !== undefined) {
      best = prev;
      bestD = at(top, prev);
    }
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === top) continue;
      const d = at(top, k);
      // Strictly closer only: ties keep `prev` (needed to terminate) or the lower index.
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    if (best === prev && prev !== undefined) {
      chain.pop();
      chain.pop();
      const [a, b] = top < prev ? [top, prev] : [prev, top];
      merges.push({ a: anchor[a] ?? a, b: anchor[b] ?? b, d: bestD });
      // Lance–Williams update for average linkage; the merged cluster lives in slot `a`.
      const sa = size[a] ?? 1;
      const sb = size[b] ?? 1;
      for (let k = 0; k < n; k++) {
        if (!active[k] || k === a || k === b) continue;
        const d = (sa * at(a, k) + sb * at(b, k)) / (sa + sb);
        dist[a * n + k] = d;
        dist[k * n + a] = d;
      }
      size[a] = sa + sb;
      active[b] = 0;
      remaining--;
    } else {
      chain.push(best);
    }
  }
  // Average linkage is reducible, so the merges below the threshold form exactly the cut.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x] ?? x] ?? x;
    return x;
  };
  for (const m of merges) if (m.d < threshold) parent[find(m.b)] = find(m.a);
  return Array.from({ length: n }, (_, i) => find(i));
}

/**
 * What gets embedded for an item: its distinct non-stopword words, sorted and each repeated, so the
 * n-gram embedding measures shared words (unigrams and their self-bigrams dominate) rather than word
 * order. Without this, two headlines about the same story rarely come within the distance threshold.
 */
export function clusterText(item: { title: string; keywords: readonly string[] }): string {
  const words = new Set<string>();
  for (const w of [
    ...titleKey(item.title).split(" "),
    ...item.keywords.flatMap((k) => titleKey(k).split(" ")),
  ]) {
    if (w.length >= 3 && !/^\d+$/.test(w) && !LABEL_STOPWORDS.has(w)) words.add(w);
  }
  return [...words]
    .sort()
    .map((w) => `${w} ${w} ${w}`)
    .join(" ");
}

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** 2–6 most frequent non-stopword keywords of the cluster; ties keep first-seen order. */
function labelWords(items: readonly Item[], fallback: string): string[] {
  const count = new Map<string, number>();
  const order: string[] = [];
  for (const it of items) {
    const seen = new Set<string>();
    const words = [...it.keywords.flatMap((k) => k.split(/\s+/)), ...titleKey(it.title).split(" ")];
    for (const raw of words) {
      const w = raw.toLowerCase();
      if (w.length < 3 || /^\d+$/.test(w) || LABEL_STOPWORDS.has(w) || seen.has(w)) continue;
      seen.add(w);
      if (!count.has(w)) order.push(w);
      count.set(w, (count.get(w) ?? 0) + 1);
    }
  }
  const ranked = [...order].sort(
    (a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b),
  );
  const shared = ranked.filter((w) => (count.get(w) ?? 0) >= 2).length;
  const n = Math.min(6, Math.max(items.length > 1 ? 2 : 3, shared));
  const out = ranked.slice(0, n);
  for (const w of fallback.toLowerCase().split(/\s+/)) if (out.length < 2 && !out.includes(w)) out.push(w);
  while (out.length < 2) out.push("trend");
  return out;
}

/**
 * Turn raw signals into the niche's topics with momentum (E3-02). Pure: no network, no LLM.
 * Velocity = (n24 × Σstrength24 + 1) / (mean daily (n × Σstrength) over the previous 7 days + 1),
 * where strength is the per-source log-scaled metric. Only topics active in the last 24 h are
 * returned, at most 20, by velocity.
 */
export function clusterTopics(signals: readonly TrendSignal[], niche: Niche, opts: ClusterOptions): Topic[] {
  const embedFn = opts.embed ?? localEmbed;
  const seed = opts.seed ?? 0;
  const now = opts.now.getTime();
  const from = now - (BASELINE_DAYS + 1) * DAY_MS;
  const matches = nicheMatcher(niche);
  const inWindow = signals.filter((s) => {
    const t = Date.parse(s.observedAt);
    return t > from && t <= now && matches(s);
  });
  const strength = strengths(inWindow);

  // Group repeated observations of the same story (e.g. a video in mostPopular every hour).
  const byKey = new Map<string, TrendSignal[]>();
  for (const s of inWindow) {
    const k = `${s.source}|${titleKey(s.title)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  let items: Item[] = [...byKey.entries()].map(([key, group]) => {
    // Canonical representative: earliest observation, then id (independent of input order).
    const sorted = [...group].sort(
      (a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id),
    );
    const rep = sorted[0] as TrendSignal;
    const observations = sorted.map((s) => ({
      at: Date.parse(s.observedAt),
      strength: strength.get(s) ?? 0,
    }));
    return {
      key,
      title: rep.title,
      url: sorted.find((s) => s.url)?.url,
      source: rep.source,
      keywords: [...new Set(sorted.flatMap((s) => s.keywords.map((k) => k.toLowerCase())))],
      observations,
      strength: observations.reduce((a, o) => a + o.strength, 0),
      rank: sha(`${seed}|${key}`),
    };
  });
  if (items.length > MAX_CLUSTER_ITEMS) {
    items = [...items]
      .sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key))
      .slice(0, MAX_CLUSTER_ITEMS);
  }
  // Seeded order: the input order never matters, and the seed decides ties.
  items.sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
  const n = items.length;
  if (n === 0) return [];

  const vecs = items.map((it) => sparse(embedFn(clusterText(it))));
  const dist = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - sparseCosine(vecs[i] as (typeof vecs)[number], vecs[j] as (typeof vecs)[number]);
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }
  const assignment = n === 1 ? [0] : averageLinkage(dist, n, CLUSTER_DISTANCE_THRESHOLD);

  const clusters = new Map<number, Item[]>();
  assignment.forEach((c, i) => clusters.set(c, [...(clusters.get(c) ?? []), items[i] as Item]));

  const day24 = now - DAY_MS;
  const topics: Topic[] = [];
  for (const members of clusters.values()) {
    const obs = members.flatMap((m) => m.observations);
    const recent = obs.filter((o) => o.at > day24);
    if (recent.length === 0) continue;
    const recentStrength = recent.reduce((a, o) => a + o.strength, 0);
    let baseline = 0;
    for (let d = 1; d <= BASELINE_DAYS; d++) {
      const day = obs.filter((o) => o.at > now - (d + 1) * DAY_MS && o.at <= now - d * DAY_MS);
      baseline += day.length * day.reduce((a, o) => a + o.strength, 0);
    }
    const velocity = (recent.length * recentStrength + 1) / (baseline / BASELINE_DAYS + 1);
    // Strongest stories first for the label and the sources.
    const ranked = [...members].sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));
    const words = labelWords(ranked, niche.name);
    const sources: TopicSource[] = ranked.slice(0, 10).map((m) => ({
      ...(m.url ? { url: m.url } : {}),
      title: m.title.slice(0, 500),
      source: m.source,
    }));
    const keywords = words.slice(0, 6);
    topics.push({
      id: `top_${sha([...keywords].sort().join("|")).slice(0, 16)}`,
      nicheId: niche.id,
      label: words.map(titleCase).join(" "),
      keywords,
      velocity: Number(velocity.toPrecision(6)),
      signals24h: recent.length,
      sources,
      firstSeen: new Date(Math.min(...obs.map((o) => o.at))).toISOString(),
    });
  }
  topics.sort(
    (a, b) =>
      b.velocity - a.velocity || a.label.localeCompare(b.label) || a.firstSeen.localeCompare(b.firstSeen),
  );
  // Two clusters can share their top keywords: keep ids unique (the stronger keeps the plain hash).
  const seen = new Map<string, number>();
  for (const t of topics) {
    const k = (seen.get(t.id) ?? 0) + 1;
    seen.set(t.id, k);
    if (k > 1) t.id = `${t.id}_${k}`;
  }
  return topics.slice(0, MAX_TOPICS);
}

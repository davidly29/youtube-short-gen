import {
  FormatSlug,
  HookType,
  Recommendation,
  RecommendationOverride,
  type RecommendationField,
  type RecommendationReason,
  type ShortFeatures,
  type TargetSeconds,
} from "@shortloop/contracts";
import { eq, schema, type Db } from "@shortloop/db";
import { featureExportRows } from "./features";

/**
 * Per-channel recommender (E10-03): a Bayesian bandit over format × hook type.
 *
 * Reward is a Short's avg view % relative to its own channel's average ("lift": 1.2 = 20% better than
 * usual), so channels with different baselines can share evidence. Each arm has a Normal posterior on
 * lift whose prior comes from the shared pool (Shorts of opted-in channels, shrunk toward 1) and whose
 * likelihood is the channel's own Shorts. `chooseArm` is the bandit policy (Thompson sampling with a
 * seeded RNG): it picks what to make next, exploring untried arms in proportion to how plausible they are.
 * The recommendation shown to the user ranks arms by posterior mean (what the evidence supports) and breaks
 * ties, such as between untried arms, with Thompson draws, so a new channel still explores. Everything is
 * stable for a given seed (the default seed is the day). Length and posting hour are picked per bucket.
 *
 * Only suggestions come out of here; nothing is published without the user's approval.
 */

/** What the recommender needs about one Short: a feature row with its metric totals. */
export interface PerformanceRow {
  channelId: string;
  features: Pick<ShortFeatures, "format" | "hookType" | "durationS" | "postHour">;
  views: number;
  avgViewPct: number | null;
}

export type ArmFormat = FormatSlug | "custom";
export interface Arm {
  format: ArmFormat;
  hookType: HookType;
}

export interface ArmPosterior extends Arm {
  /** Posterior mean of lift. */
  mean: number;
  /** Posterior standard deviation of the mean. */
  sd: number;
  /** The channel's own Shorts in this arm. */
  shorts: number;
  /** Shared-pool Shorts in this arm (from other opted-in channels). */
  priorShorts: number;
  /** The prior mean of lift from the shared pool (1 without shared data). */
  priorMean: number;
}

/** Assumed spread of one Short's lift around its arm's true lift. */
export const LIFT_SD = 0.3;
/** Pseudo-Shorts at lift 1 that the shared pool is shrunk toward. */
export const SHARED_SHRINK = 5;
/**
 * How far one channel's arm can sit from the prior (between-arm spread of true lift). The prior then counts
 * as (LIFT_SD / ARM_SD)² = 4 pseudo-Shorts in the channel's own posterior.
 */
export const ARM_SD = 0.15;
const PRIOR_WEIGHT = (LIFT_SD / ARM_SD) ** 2;
/** Own Shorts a length or hour bucket needs before it is trusted over the shared pool / default. */
export const MIN_BUCKET_SHORTS = 3;
export const DEFAULT_TARGET_SECONDS: TargetSeconds = 45;
/** Default posting hour (UTC) when neither the channel nor the shared pool says otherwise. */
export const DEFAULT_POST_HOUR = 17;

export const ARM_FORMATS: readonly ArmFormat[] = [...FormatSlug.options, "custom"];
export const ARMS: readonly Arm[] = ARM_FORMATS.flatMap((format) =>
  HookType.options.map((hookType) => ({ format, hookType })),
);
/** The element at `i`; throws instead of returning undefined (the arm lists are never empty). */
function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`index ${i} out of range`);
  return x;
}
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const armKey = (a: Arm) => `${a.format}|${a.hookType}`;

const FORMAT_LABEL: Record<ArmFormat, string> = {
  "trend-explainer": "Trend explainer",
  "myth-vs-fact": "Myth vs fact",
  "top-3-list": "Top-3 list",
  "news-in-60s": "News in 60s",
  custom: "Own-topic",
};
const HOOK_LABEL: Record<HookType, string> = {
  question: "question",
  number: "number/list",
  how_why: "how/why",
  contrarian: "contrarian",
  statement: "statement",
};

// ---------------------------------------------------------------------------------------------------------
// Seeded randomness (deterministic given a seed)

export type Rng = () => number;

/** FNV-1a hash of a string to a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast seeded PRNG in [0, 1). */
export function seededRng(seed: number | string): Rng {
  let a = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw (Box–Muller). */
export function normal(rng: Rng): number {
  const u = Math.max(rng(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------------------------------------------------------------------------------------------------
// Lifts and posteriors (pure)

interface Lifted {
  channelId: string;
  features: PerformanceRow["features"];
  lift: number;
}

/** Shorts with results, scored as avg view % over their channel's view-weighted average. */
export function lifts(rows: readonly PerformanceRow[]): Lifted[] {
  const scored = rows.filter(
    (r): r is PerformanceRow & { avgViewPct: number } => r.views > 0 && r.avgViewPct !== null,
  );
  const base = new Map<string, { views: number; weighted: number }>();
  for (const r of scored) {
    const b = base.get(r.channelId) ?? { views: 0, weighted: 0 };
    b.views += r.views;
    b.weighted += r.views * r.avgViewPct;
    base.set(r.channelId, b);
  }
  return scored.flatMap((r) => {
    const b = base.get(r.channelId);
    const avg = b && b.views > 0 ? b.weighted / b.views : 0;
    return avg > 0 ? [{ channelId: r.channelId, features: r.features, lift: r.avgViewPct / avg }] : [];
  });
}

const sumBy = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/**
 * Normal posterior of lift for every format × hook arm: the shared pool (shrunk toward 1) is the prior,
 * the channel's own Shorts the evidence.
 */
export function armPosteriors(
  own: readonly PerformanceRow[],
  shared: readonly PerformanceRow[],
): ArmPosterior[] {
  const ownL = lifts(own);
  const sharedL = lifts(shared);
  const inArm = (xs: Lifted[], a: Arm) =>
    xs.filter((x) => x.features.format === a.format && x.features.hookType === a.hookType);
  return ARMS.map((a) => {
    const s = inArm(sharedL, a);
    const o = inArm(ownL, a);
    const priorMean = (SHARED_SHRINK + sumBy(s, (x) => x.lift)) / (SHARED_SHRINK + s.length);
    const k = PRIOR_WEIGHT;
    const mean = (k * priorMean + sumBy(o, (x) => x.lift)) / (k + o.length);
    return {
      ...a,
      mean,
      sd: LIFT_SD / Math.sqrt(k + o.length),
      shorts: o.length,
      priorShorts: s.length,
      priorMean,
    };
  });
}

/** One Thompson draw per arm, highest first. */
export function thompsonRank(
  posteriors: readonly ArmPosterior[],
  rng: Rng,
): (ArmPosterior & { draw: number })[] {
  return posteriors
    .map((p) => ({ ...p, draw: p.mean + p.sd * normal(rng) }))
    .sort((x, y) => y.draw - x.draw || armKey(x).localeCompare(armKey(y)));
}

/** The arm Thompson sampling picks next. */
export function chooseArm(posteriors: readonly ArmPosterior[], rng: Rng): Arm {
  const best = at(thompsonRank(posteriors, rng), 0);
  return { format: best.format, hookType: best.hookType };
}

/** Nearest length the script generator supports. */
export function lengthBucket(durationS: number): TargetSeconds {
  if (durationS < 37.5) return 30;
  if (durationS < 52.5) return 45;
  return 60;
}

interface BucketPick<K> {
  value: K;
  source: "channel" | "shared_prior";
  shorts: number;
  lift: number;
}

/** The bucket with the best shrunk mean lift among buckets with enough Shorts, or undefined. */
function bestBucket<K extends string | number>(
  xs: Lifted[],
  key: (x: Lifted) => K,
): { value: K; shorts: number; lift: number } | undefined {
  const groups = new Map<K, number[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x.lift]);
  let best: { value: K; shorts: number; lift: number } | undefined;
  for (const [value, ls] of [...groups].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (ls.length < MIN_BUCKET_SHORTS) continue;
    const lift = (1 + sumBy(ls, (l) => l)) / (1 + ls.length);
    if (!best || lift > best.lift) best = { value, shorts: ls.length, lift };
  }
  return best;
}

function pickBucket<K extends string | number>(
  own: Lifted[],
  shared: Lifted[],
  key: (x: Lifted) => K,
): BucketPick<K> | undefined {
  const o = bestBucket(own, key);
  if (o) return { ...o, source: "channel" };
  const s = bestBucket(shared, key);
  return s ? { ...s, source: "shared_prior" } : undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const times = (lift: number) => `${round2(lift).toFixed(2)}×`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00 UTC`;

export interface RecommendInput {
  channelId: string;
  /** The channel's own Shorts with results. */
  own: readonly PerformanceRow[];
  /** Shorts of other channels whose owners opted in to sharing (the shared prior). */
  shared?: readonly PerformanceRow[];
  /** Seed for the Thompson draws; same seed + data = same recommendation. */
  seed: string;
}

/** `recommend` without I/O: rank formats and hooks, pick a length and an hour, and say why. */
export function recommendFromRows(input: RecommendInput): Recommendation {
  const own = input.own.filter((r) => r.channelId === input.channelId);
  const shared = (input.shared ?? []).filter((r) => r.channelId !== input.channelId);
  const ownL = lifts(own);
  const sharedL = lifts(shared);
  const ranked = thompsonRank(armPosteriors(own, shared), seededRng(`${input.channelId}|${input.seed}`)).sort(
    (x, y) => (Math.abs(y.mean - x.mean) > 1e-9 ? y.mean - x.mean : y.draw - x.draw),
  );

  const firstSeen = <T>(xs: T[]) => [...new Set(xs)];
  const preferredFormats = firstSeen(
    ranked.map((a) => a.format).filter((f): f is FormatSlug => f !== "custom"),
  ).slice(0, 3);
  const hookPatterns = firstSeen(ranked.map((a) => a.hookType)).slice(0, 3);
  const top = ranked.find((a) => a.format !== "custom") ?? at(ranked, 0);
  const topHook = at(ranked, 0);

  const armReason = (field: RecommendationField, a: ArmPosterior, what: string): RecommendationReason => {
    if (a.shorts > 0)
      return {
        field,
        source: "channel",
        text: `${what} keep about ${times(a.mean)} your average view % (based on ${a.shorts} of your Shorts).`,
        shorts: a.shorts,
        lift: round2(a.mean),
      };
    if (a.priorShorts > 0)
      return {
        field,
        source: "shared_prior",
        text: `You haven't tried ${what.toLowerCase()} yet; on similar channels it keeps ${times(a.priorMean)} their average view % (${plural(a.priorShorts, "Short")}).`,
        shorts: 0,
        lift: round2(a.priorMean),
      };
    return {
      field,
      source: "default",
      text: `Not enough results yet: we're trying ${what.toLowerCase()} to learn what your audience keeps watching.`,
      shorts: 0,
    };
  };

  const len = pickBucket(ownL, sharedL, (x) => lengthBucket(x.features.durationS));
  const hour = pickBucket(ownL, sharedL, (x) => x.features.postHour);
  const bucketReason = (
    field: RecommendationField,
    pick: BucketPick<number> | undefined,
    subject: string,
    fallback: string,
  ): RecommendationReason =>
    !pick
      ? { field, source: "default", text: fallback, shorts: 0 }
      : pick.source === "channel"
        ? {
            field,
            source: "channel",
            text: `Your ${subject} keep about ${times(pick.lift)} your average view % (${plural(pick.shorts, "Short")}).`,
            shorts: pick.shorts,
            lift: round2(pick.lift),
          }
        : {
            field,
            source: "shared_prior",
            text: `On similar channels, ${subject} keep about ${times(pick.lift)} their average view % (${plural(pick.shorts, "Short")}).`,
            shorts: 0,
            lift: round2(pick.lift),
          };

  const targetSeconds = (len?.value ?? DEFAULT_TARGET_SECONDS) as TargetSeconds;
  const postHour = hour?.value ?? DEFAULT_POST_HOUR;
  const priorChannels = new Set(sharedL.map((x) => x.channelId)).size;

  return Recommendation.parse({
    channelId: input.channelId,
    preferredFormats,
    hookPatterns,
    targetSeconds,
    postHour,
    why: [
      armReason(
        "preferredFormats",
        top,
        `${FORMAT_LABEL[top.format]} Shorts with a ${HOOK_LABEL[top.hookType]} hook`,
      ),
      armReason(
        "hookPatterns",
        topHook,
        `${capitalise(HOOK_LABEL[topHook.hookType])} hooks on ${FORMAT_LABEL[topHook.format].toLowerCase()} Shorts`,
      ),
      bucketReason(
        "targetSeconds",
        len,
        `${targetSeconds}-second Shorts`,
        `Not enough results yet: ${DEFAULT_TARGET_SECONDS} seconds is a safe default for Shorts.`,
      ),
      bucketReason(
        "postHour",
        hour,
        `Shorts posted at ${hourLabel(postHour)}`,
        `Not enough results yet: ${hourLabel(DEFAULT_POST_HOUR)} (evening in Europe, midday in the US) is where we start.`,
      ),
    ],
    basedOn: { shorts: ownL.length, priorShorts: sharedL.length, priorChannels },
  });
}

const FIELD_TEXT: Record<RecommendationField, (r: Recommendation) => string> = {
  preferredFormats: (r) => r.preferredFormats.map((f) => FORMAT_LABEL[f]).join(", "),
  hookPatterns: (r) => r.hookPatterns.map((h) => HOOK_LABEL[h]).join(", "),
  targetSeconds: (r) => `${r.targetSeconds} seconds`,
  postHour: (r) => hourLabel(r.postHour),
};

/**
 * Apply the user's override: each overridden field takes their value, and its reason says it was their
 * choice and what the data suggested instead, so they can always see both.
 */
export function applyOverride(rec: Recommendation, override: RecommendationOverride): Recommendation {
  const o = RecommendationOverride.parse(override);
  const next: Recommendation = {
    ...rec,
    preferredFormats: o.preferredFormats ?? rec.preferredFormats,
    hookPatterns: o.hookPatterns ?? rec.hookPatterns,
    targetSeconds: o.targetSeconds ?? rec.targetSeconds,
    postHour: o.postHour ?? rec.postHour,
  };
  const overridden = (f: RecommendationField) => o[f] !== undefined;
  next.why = rec.why.map((w) =>
    overridden(w.field)
      ? {
          field: w.field,
          source: "user",
          text: `You chose this${o.note ? `: ${o.note}` : ""}. Data suggested ${FIELD_TEXT[w.field](rec)}. ${w.text}`.slice(
            0,
            300,
          ),
          shorts: w.shorts,
          ...(w.lift !== undefined ? { lift: w.lift } : {}),
        }
      : w,
  );
  return Recommendation.parse(next);
}

// ---------------------------------------------------------------------------------------------------------
// Offline replay (Li et al. 2011): evaluate a policy on logs collected under uniform-random choices.

export interface LoggedShort extends Arm {
  avgViewPct: number;
}

export interface ReplayResult {
  /** Logged Shorts where the policy chose the logged arm (the only ones it is scored on). */
  matched: number;
  /** Mean avg view % over the matched Shorts. */
  meanAvgViewPct: number;
}

/**
 * Replay a policy over a channel's log: at each step the policy chooses an arm from the history it has
 * accepted so far; if that is the logged arm, the Short is scored and joins the history. Unbiased for
 * logs whose arms were chosen uniformly at random.
 */
export function replay(
  log: readonly LoggedShort[],
  policy: "bandit" | "uniform",
  seed: string,
  shared: readonly PerformanceRow[] = [],
): ReplayResult {
  const rng = seededRng(`replay|${policy}|${seed}`);
  const history: PerformanceRow[] = [];
  let total = 0;
  for (const e of log) {
    const arm =
      policy === "uniform"
        ? at(ARMS, Math.floor(rng() * ARMS.length))
        : chooseArm(armPosteriors(history, shared), rng);
    if (arm.format !== e.format || arm.hookType !== e.hookType) continue;
    total += e.avgViewPct;
    history.push({
      channelId: "replay",
      views: 1,
      avgViewPct: e.avgViewPct,
      features: { format: e.format, hookType: e.hookType, durationS: 45, postHour: DEFAULT_POST_HOUR },
    });
  }
  return { matched: history.length, meanAvgViewPct: history.length ? total / history.length : 0 };
}

// ---------------------------------------------------------------------------------------------------------
// With the database

export class RecommendError extends Error {}

export interface RecommendOptions {
  /**
   * Channels whose owners opted in to sharing results; their Shorts form the shared prior. Until the
   * opt-in setting exists the caller passes none, and the channel learns from its own Shorts only.
   */
  priorChannelIds?: readonly string[];
  /** The user's saved override, applied on top. */
  override?: RecommendationOverride;
  /** Thompson seed; defaults to the UTC day so a channel's recommendation is stable within a day. */
  seed?: string;
  now?: Date;
}

/** `recommend(channelId)` from the ticket: what this channel's next Shorts should favour, and why. */
export async function recommend(
  db: Db,
  channelId: string,
  opts: RecommendOptions = {},
): Promise<Recommendation> {
  const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) });
  if (!channel) throw new RecommendError(`channel ${channelId} not found`);
  const own = (await featureExportRows(db, { ownerId: channel.ownerId })).filter(
    (r) => r.channelId === channelId,
  );
  const priorIds = new Set((opts.priorChannelIds ?? []).filter((id) => id !== channelId));
  const shared = priorIds.size ? (await featureExportRows(db)).filter((r) => priorIds.has(r.channelId)) : [];
  const rec = recommendFromRows({
    channelId,
    own,
    shared,
    seed: opts.seed ?? (opts.now ?? new Date()).toISOString().slice(0, 10),
  });
  return opts.override ? applyOverride(rec, opts.override) : rec;
}

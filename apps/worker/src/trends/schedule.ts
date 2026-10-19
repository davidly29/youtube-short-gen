import type { Job } from "@shortloop/contracts";
import { type Db, ensureTrendsOwner, hourBucket } from "@shortloop/db";
import type { JobService } from "@shortloop/pipeline";
import { youtubeDailyQuota, YOUTUBE_TRENDS_DAILY_QUOTA } from "@shortloop/providers";
import type { TrendsJobInput } from "./collect";

export interface TrendsConfig {
  /** ISO 3166-1 alpha-2 regions, e.g. IE, GB, US. */
  regions: string[];
  /** YouTube video category ids, e.g. 27 (Education), 28 (Science & Technology). */
  categoryIds: string[];
}

export const DEFAULT_TRENDS_CONFIG: TrendsConfig = { regions: ["IE", "GB", "US"], categoryIds: ["27", "28"] };

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * `TRENDS_REGIONS` / `TRENDS_CATEGORIES` (comma-separated), defaulting to IE,GB,US and 27,28.
 * Throws on a malformed value or a category list that would exceed the YouTube quota budget.
 */
export function trendsConfigFromEnv(env: Record<string, string | undefined> = process.env): TrendsConfig {
  const regions = list(env.TRENDS_REGIONS).map((r) => r.toUpperCase());
  const categoryIds = list(env.TRENDS_CATEGORIES);
  const config = {
    regions: regions.length ? [...new Set(regions)] : DEFAULT_TRENDS_CONFIG.regions,
    categoryIds: categoryIds.length ? [...new Set(categoryIds)] : DEFAULT_TRENDS_CONFIG.categoryIds,
  };
  const badRegion = config.regions.find((r) => !/^[A-Z]{2}$/.test(r));
  if (badRegion) throw new Error(`TRENDS_REGIONS: "${badRegion}" is not a two-letter region code`);
  const badCat = config.categoryIds.find((c) => !/^\d+$/.test(c));
  if (badCat) throw new Error(`TRENDS_CATEGORIES: "${badCat}" is not a numeric YouTube category id`);
  const units = youtubeDailyQuota(config.categoryIds.length);
  if (units > YOUTUBE_TRENDS_DAILY_QUOTA) {
    throw new Error(
      `TRENDS_CATEGORIES: ${config.categoryIds.length} categories hourly = ${units} YouTube quota units/day per region (budget ${YOUTUBE_TRENDS_DAILY_QUOTA})`,
    );
  }
  return config;
}

/** The idempotency key of one region's collection for one hour. */
export const trendsJobKey = (region: string, hourIso: string) => `trends:${region}:${hourIso}`;

/**
 * Enqueue this hour's collection: one job per region plus one `global` job (niche RSS feeds).
 * Idempotent per hour, so calling it every few minutes collects each region exactly once an hour.
 * Jobs are owned by the system user and cost no credits.
 */
export async function scheduleTrends(
  jobs: JobService,
  db: Db,
  config: TrendsConfig,
  now: Date = new Date(),
): Promise<Job[]> {
  const ownerId = await ensureTrendsOwner(db);
  const hour = hourBucket(now.toISOString());
  const out: Job[] = [];
  for (const region of [...config.regions, "global"]) {
    const input: TrendsJobInput = { region, categoryIds: config.categoryIds, hour };
    out.push(
      await jobs.enqueue(
        "trends",
        { ...input },
        { idempotencyKey: trendsJobKey(region, hour), ownerId, costCredits: 0 },
      ),
    );
  }
  return out;
}

/**
 * Repeatable hourly trend collection: checks every `everyMs` (default 5 min) and enqueues the
 * current hour's jobs, which the idempotency keys collapse to one run per region per hour.
 * Returns a stop function.
 */
export function startTrendSchedule(
  jobs: JobService,
  db: Db,
  config: TrendsConfig,
  opts: { everyMs?: number; now?: () => Date } = {},
): () => void {
  const tick = () =>
    void scheduleTrends(jobs, db, config, opts.now?.() ?? new Date()).catch((e) =>
      console.error("trends schedule failed", e),
    );
  tick();
  const timer = setInterval(tick, opts.everyMs ?? 5 * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

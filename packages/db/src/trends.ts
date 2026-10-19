import type { TrendSignal } from "@shortloop/contracts";
import { lt } from "drizzle-orm";
import type { Db } from "./client";
import { trendSignals, users } from "./schema";

/** Signals older than this are deleted by `pruneSignals` (E3-01: "store raw signals 30 days"). */
export const TREND_RETENTION_DAYS = 30;

/**
 * Trend collection is platform-level work, not billed to anyone: its jobs are owned by this system
 * user (no credits, no API keys of its own; it never signs in because it has no auth account).
 */
export const TRENDS_OWNER_ID = "system";

/** Create the system user that owns trend jobs, if it isn't there yet. */
export async function ensureTrendsOwner(db: Db): Promise<string> {
  await db
    .insert(users)
    .values({
      id: TRENDS_OWNER_ID,
      email: "system@shortloop.invalid",
      name: "ShortLoop system",
      role: "system",
      creditExempt: true,
    })
    .onConflictDoNothing();
  return TRENDS_OWNER_ID;
}

/** `observedAt` truncated to the hour, as ISO: the dedupe bucket of a signal. */
export const hourBucket = (iso: string): string => {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
};

/**
 * Store signals. Idempotent: a signal with the same id, or the same (source, region, category, title)
 * in the same hour, is skipped. Returns how many rows were actually inserted.
 */
export async function insertSignals(db: Db, signals: readonly TrendSignal[]): Promise<number> {
  if (signals.length === 0) return 0;
  const rows = signals.map((s) => ({
    id: s.id,
    source: s.source,
    region: s.region,
    categoryId: s.categoryId ?? "",
    niche: s.niche ?? null,
    title: s.title,
    url: s.url ?? null,
    keywords: s.keywords,
    metric: s.metric,
    observedAt: new Date(s.observedAt).toISOString(),
    observedHour: hourBucket(s.observedAt),
  }));
  let inserted = 0;
  // Chunked so a large batch stays well under Postgres' bind-parameter limit.
  for (let i = 0; i < rows.length; i += 500) {
    const res = await db
      .insert(trendSignals)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing()
      .returning();
    inserted += res.length;
  }
  return inserted;
}

/** Delete signals observed more than `olderThanDays` before `now`. Returns how many were deleted. */
export async function pruneSignals(
  db: Db,
  now: Date,
  olderThanDays: number = TREND_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  const res = await db.delete(trendSignals).where(lt(trendSignals.observedAt, cutoff)).returning();
  return res.length;
}

/** Map a stored row back to the contract shape. */
export function toTrendSignal(row: typeof trendSignals.$inferSelect): TrendSignal {
  return {
    id: row.id,
    source: row.source,
    region: row.region as TrendSignal["region"],
    ...(row.categoryId ? { categoryId: row.categoryId } : {}),
    ...(row.niche ? { niche: row.niche } : {}),
    title: row.title,
    ...(row.url ? { url: row.url } : {}),
    keywords: row.keywords,
    metric: row.metric,
    observedAt: new Date(row.observedAt).toISOString(),
  };
}

import "server-only";
import { schema, sql, type Db } from "@shortloop/db";

export interface RateDecision {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the current window ends. */
  resetAt: number;
  /** Seconds to wait, when `ok` is false. */
  retryAfter: number;
}

const WINDOW_MS = 60_000;

/**
 * Count one request against `keyId`'s fixed one-minute window (E12-01). The counter lives in Postgres, so every
 * web instance shares it; the upsert is atomic, so concurrent requests can't both take the last slot.
 */
export async function hitRateLimit(
  db: Db,
  keyId: string,
  limit: number,
  now = Date.now(),
): Promise<RateDecision> {
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const [row] = await db
    .insert(schema.apiRateWindows)
    .values({ keyId, windowStart: new Date(start).toISOString(), count: 1 })
    .onConflictDoUpdate({
      target: [schema.apiRateWindows.keyId, schema.apiRateWindows.windowStart],
      set: { count: sql`${schema.apiRateWindows.count} + 1` },
    })
    .returning();
  const count = row?.count ?? 1;
  const end = start + WINDOW_MS;
  // Housekeeping: drop this key's old windows now and then.
  if (count === 1) {
    await db.execute(
      sql`delete from ${schema.apiRateWindows} where ${schema.apiRateWindows.keyId} = ${keyId} and ${schema.apiRateWindows.windowStart} < ${new Date(start).toISOString()}`,
    );
  }
  return {
    ok: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: Math.ceil(end / 1000),
    retryAfter: Math.max(1, Math.ceil((end - now) / 1000)),
  };
}

/** `API_RATE_LIMIT_PER_MINUTE` (a positive integer), else the default. */
export function rateLimitFromEnv(
  fallback: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env.API_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

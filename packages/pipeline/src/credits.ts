import { and, type Db, eq, schema, sql, sum } from "@shortloop/db";
import { refundJob } from "./jobs";

export type CreditUnit = "short" | "ai_video_credit";

/** An amount per unit, e.g. { short: 1, ai_video_credit: 2 }. */
export type Credits = Partial<Record<CreditUnit, number>>;

/** What a job will consume. One finished Short = 1 short credit; generative video costs 1 credit per 5 s. */
export interface JobPlan {
  shorts?: number;
  aiVideoSeconds?: number;
}

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(
    readonly unit: CreditUnit,
    readonly needed: number,
    readonly available: number,
  ) {
    super(`INSUFFICIENT_CREDITS: need ${needed} ${unit}, have ${available}`);
  }
}

export function estimate(plan: JobPlan): Credits {
  const out: Credits = {};
  if (plan.shorts) out.short = plan.shorts;
  if (plan.aiVideoSeconds) out.ai_video_credit = Math.ceil(plan.aiVideoSeconds / 5);
  return out;
}

const units = (c: Credits) => (Object.entries(c) as [CreditUnit, number][]).filter(([, n]) => n > 0);

async function balanceIn(tx: Db, ownerId: string, unit: CreditUnit): Promise<number> {
  const [row] = await tx
    .select({ total: sum(schema.creditLedger.delta) })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.ownerId, ownerId), eq(schema.creditLedger.unit, unit)));
  return Number(row?.total ?? 0);
}

/**
 * Hold credits for a job. Serialised per owner with a transaction-scoped advisory lock, so
 * concurrent reserves can never overdraw. Throws InsufficientCreditsError (code INSUFFICIENT_CREDITS).
 */
export async function reserve(db: Db, ownerId: string, credits: Credits, jobId: string): Promise<void> {
  await (db as unknown as { transaction: (fn: (tx: Db) => Promise<void>) => Promise<void> }).transaction(
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`);
      for (const [unit, amount] of units(credits)) {
        const available = await balanceIn(tx, ownerId, unit);
        if (available < amount) throw new InsufficientCreditsError(unit, amount, available);
      }
      for (const [unit, amount] of units(credits)) {
        await tx
          .insert(schema.creditLedger)
          .values({ ownerId, unit, delta: -amount, reason: `reserve:${unit}`, jobId });
      }
    },
  );
}

/** Charge the actual amount: releases whatever was reserved beyond `actual` (never charges more than reserved). */
export async function settle(db: Db, jobId: string, actual: Credits): Promise<void> {
  const reserved = await db
    .select({
      ownerId: schema.creditLedger.ownerId,
      unit: schema.creditLedger.unit,
      delta: schema.creditLedger.delta,
      reason: schema.creditLedger.reason,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.jobId, jobId));
  for (const r of reserved.filter((x) => x.reason === `reserve:${x.unit}`)) {
    const held = -r.delta;
    const used = Math.min(held, actual[r.unit] ?? 0);
    const release = held - used;
    if (release > 0) {
      await db
        .insert(schema.creditLedger)
        .values({ ownerId: r.ownerId, unit: r.unit, delta: release, reason: `release:${r.unit}`, jobId })
        .onConflictDoNothing();
    }
  }
}

/** Return everything a job holds (failure or cancellation). */
export const refund = (db: Db, jobId: string) => refundJob(db, jobId);

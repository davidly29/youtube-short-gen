import { and, eq, sum } from "drizzle-orm";
import type { Db } from "./client";
import { creditLedger } from "./schema";

export type CreditUnit = (typeof creditLedger.$inferInsert)["unit"];

/** Balance = sum of all ledger deltas for an owner and unit (0 when there are none). */
export async function balance(db: Db, ownerId: string, unit: CreditUnit): Promise<number> {
  const [row] = await db
    .select({ total: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(and(eq(creditLedger.ownerId, ownerId), eq(creditLedger.unit, unit)));
  return Number(row?.total ?? 0);
}

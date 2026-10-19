import { randomUUID } from "node:crypto";
import { PLANS, type BillingEvent, type PlanId } from "@shortloop/contracts";
import { and, asc, balance, eq, gte, isNull, lte, schema, sql, type Db } from "@shortloop/db";

/** Stripe price id -> plan (from STRIPE_PRICE_CREATOR / STRIPE_PRICE_PRO). */
export type PriceMap = Record<string, PlanId>;

/** Ledger reasons for credits that never expire. Spending uses expiring credits first, so these are kept longest. */
const NON_EXPIRING_REASONS = ["signup"];

type Tx = Db;
const inTx = <T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  (db as unknown as { transaction: (f: (tx: Tx) => Promise<T>) => Promise<T> }).transaction(fn);
const lockOwner = (tx: Tx, ownerId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`);

export interface ApplyResult {
  applied: boolean;
  /** Why nothing happened (duplicate event, unknown price, ...). */
  skipped?: string;
  granted?: { short: number; ai_video_credit: number };
}

/**
 * Apply one webhook event exactly once (event ids are recorded in the same transaction as the effects).
 * - checkout completed / subscription changed: keep the user's plan, status and period in sync
 * - invoice paid: grant the plan's monthly credits once per invoice, expiring at the invoice period's end
 */
export async function applyBillingEvent(
  db: Db,
  ev: BillingEvent,
  prices: PriceMap,
  now = new Date(),
): Promise<ApplyResult> {
  return inTx(db, async (tx) => {
    const fresh = await tx
      .insert(schema.billingEvents)
      .values({ id: ev.eventId, type: ev.kind })
      .onConflictDoNothing()
      .returning();
    if (fresh.length === 0) return { applied: false, skipped: "duplicate event" };

    if (ev.kind === "ignored") return { applied: false, skipped: `ignored ${ev.type}` };

    if (ev.kind === "checkout_completed") {
      await upsertSubscription(tx, ev.userId, ev.customerId, {
        stripeSubscriptionId: ev.subscriptionId ?? null,
      });
      return { applied: true };
    }

    const userId = ev.userId ?? (await userForCustomer(tx, ev.customerId));
    if (!userId) return { applied: false, skipped: "unknown customer" };
    const plan = ev.priceId ? prices[ev.priceId] : undefined;

    if (ev.kind === "subscription_changed") {
      await upsertSubscription(tx, userId, ev.customerId, {
        stripeSubscriptionId: ev.subscriptionId,
        plan: plan ?? null,
        status: ev.status,
        currentPeriodEnd: ev.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: ev.cancelAtPeriodEnd,
      });
      return { applied: true };
    }

    // invoice_paid
    if (!plan) return { applied: false, skipped: `unknown price ${ev.priceId ?? "(none)"}` };
    await upsertSubscription(tx, userId, ev.customerId, {
      stripeSubscriptionId: ev.subscriptionId ?? null,
      plan,
    });
    const sub = await tx.query.subscriptions.findFirst({ where: eq(schema.subscriptions.userId, userId) });
    if (sub?.status === "canceled") return { applied: false, skipped: "subscription cancelled" };
    if (new Date(ev.periodEnd).getTime() <= now.getTime())
      return { applied: false, skipped: "invoice period already over" };

    await lockOwner(tx, userId);
    await expireDueGrants(tx, now, userId); // last month's leftovers go before this month's arrive (no rollover)
    const p = PLANS[plan];
    const granted = { short: 0, ai_video_credit: 0 };
    for (const [unit, amount] of [
      ["short", p.monthlyShorts],
      ["ai_video_credit", p.monthlyAiVideoCredits],
    ] as const) {
      if (amount <= 0) continue;
      const id = `grant_${randomUUID()}`;
      const row = await tx
        .insert(schema.creditGrants)
        .values({
          id,
          ownerId: userId,
          unit,
          amount,
          plan,
          invoiceId: ev.invoiceId,
          periodStart: ev.periodStart,
          periodEnd: ev.periodEnd,
        })
        .onConflictDoNothing()
        .returning();
      if (row.length === 0) continue; // this invoice already granted this unit
      await tx
        .insert(schema.creditLedger)
        .values({ ownerId: userId, unit, delta: amount, reason: `grant:${plan}:${ev.invoiceId}` });
      granted[unit] = amount;
    }
    return { applied: true, granted };
  });
}

async function userForCustomer(tx: Tx, customerId: string) {
  return (
    await tx.query.subscriptions.findFirst({ where: eq(schema.subscriptions.stripeCustomerId, customerId) })
  )?.userId;
}

async function upsertSubscription(
  tx: Tx,
  userId: string,
  customerId: string,
  set: Partial<Omit<typeof schema.subscriptions.$inferInsert, "userId" | "stripeCustomerId">>,
) {
  const clean = Object.fromEntries(
    Object.entries(set).filter(([, v]) => v !== undefined && v !== null),
  ) as typeof set;
  const updatedAt = new Date().toISOString();
  await tx
    .insert(schema.subscriptions)
    .values({ userId, stripeCustomerId: customerId, ...clean, updatedAt })
    .onConflictDoUpdate({
      target: schema.subscriptions.userId,
      set: { stripeCustomerId: customerId, ...clean, updatedAt },
    });
}

/**
 * Remove the unspent part of every grant whose billing period has ended (no rollover). Spending is assumed to use
 * the soonest-expiring credits first, then later grants, then non-expiring credits (signup), which favours the user.
 * Safe to run repeatedly; the worker runs it every 10 minutes.
 */
export async function expireCredits(db: Db, now = new Date(), ownerId?: string): Promise<number> {
  const due = await db
    .select({ ownerId: schema.creditGrants.ownerId })
    .from(schema.creditGrants)
    .where(
      and(
        isNull(schema.creditGrants.expiredAt),
        lte(schema.creditGrants.periodEnd, now.toISOString()),
        ownerId ? eq(schema.creditGrants.ownerId, ownerId) : undefined,
      ),
    );
  let expired = 0;
  for (const owner of new Set(due.map((d) => d.ownerId))) {
    expired += await inTx(db, async (tx) => {
      await lockOwner(tx, owner);
      return expireDueGrants(tx, now, owner);
    });
  }
  return expired;
}

/** Inside a locked transaction: expire one owner's due grants, oldest first. Returns credits removed. */
async function expireDueGrants(tx: Tx, now: Date, ownerId: string): Promise<number> {
  const grants = await tx
    .select()
    .from(schema.creditGrants)
    .where(and(eq(schema.creditGrants.ownerId, ownerId), isNull(schema.creditGrants.expiredAt)))
    .orderBy(asc(schema.creditGrants.periodEnd));
  let removed = 0;
  for (const g of grants) {
    if (new Date(g.periodEnd).getTime() > now.getTime()) continue;
    const later = grants
      .filter(
        (o) =>
          o.unit === g.unit &&
          o.id !== g.id &&
          !o.expiredAt &&
          new Date(o.periodEnd).getTime() > now.getTime(),
      )
      .reduce((n, o) => n + o.amount, 0);
    const [kept] = await tx
      .select({ total: sql<string>`coalesce(sum(${schema.creditLedger.delta}), 0)` })
      .from(schema.creditLedger)
      .where(
        and(
          eq(schema.creditLedger.ownerId, ownerId),
          eq(schema.creditLedger.unit, g.unit),
          sql`${schema.creditLedger.reason} in (${sql.join(
            NON_EXPIRING_REASONS.map((r) => sql`${r}`),
            sql`, `,
          )})`,
          gte(schema.creditLedger.delta, 0),
        ),
      );
    const bal = await balance(tx, ownerId, g.unit);
    const unspent = Math.max(0, Math.min(g.amount, bal - later - Number(kept?.total ?? 0)));
    if (unspent > 0) {
      await tx
        .insert(schema.creditLedger)
        .values({ ownerId, unit: g.unit, delta: -unspent, reason: `expire:${g.id}` });
      removed += unspent;
    }
    await tx
      .update(schema.creditGrants)
      .set({ expiredAt: now.toISOString() })
      .where(eq(schema.creditGrants.id, g.id));
    g.expiredAt = now.toISOString();
  }
  return removed;
}

/** The user's plan for display (null when on the free tier). */
export async function currentSubscription(db: Db, userId: string) {
  return (await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.userId, userId) })) ?? null;
}

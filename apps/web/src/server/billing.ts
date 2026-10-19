import "server-only";
import { PLANS, PlanId, type BillingEvent } from "@shortloop/contracts";
import { and, asc, balance, eq, gte, isNull, schema } from "@shortloop/db";
import { applyBillingEvent, currentSubscription } from "@shortloop/pipeline";
import type { FakeBilling } from "@shortloop/providers";
import { UserError } from "./errors";
import { runtime } from "./runtime";

const appUrl = (path: string) =>
  new URL(path, process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString();

export async function billingEnabled() {
  return Boolean((await runtime()).billing);
}

/** Hosted Stripe Checkout for a plan. */
export async function checkoutUrl(user: { id: string; email: string }, plan: unknown) {
  const rt = await runtime();
  if (!rt.billing) throw new UserError("Payments aren't switched on yet.");
  const p = PlanId.parse(plan);
  const priceId = Object.entries(rt.prices).find(([, v]) => v === p)?.[0];
  if (!priceId) throw new UserError(`The ${PLANS[p].name} plan isn't available yet.`);
  const sub = await currentSubscription(rt.db, user.id);
  if (sub && sub.status !== "canceled" && sub.plan)
    throw new UserError("You already have a plan. Use “Manage subscription” to change it.");
  return rt.billing.checkoutUrl({
    userId: user.id,
    email: user.email,
    priceId,
    customerId: sub?.stripeCustomerId,
    successUrl: appUrl("/billing?checkout=success"),
    cancelUrl: appUrl("/billing?checkout=cancelled"),
  });
}

export async function portalUrl(userId: string) {
  const rt = await runtime();
  const sub = await currentSubscription(rt.db, userId);
  if (!rt.billing || !sub) throw new UserError("No subscription to manage yet.");
  return rt.billing.portalUrl(sub.stripeCustomerId, appUrl("/billing"));
}

/** Verify and apply one webhook delivery. Returns false on a bad signature. */
export async function handleWebhook(rawBody: string, signature: string) {
  const rt = await runtime();
  if (!rt.billing) return { ok: false as const, status: 404 };
  let event: BillingEvent;
  try {
    event = rt.billing.parseWebhook(rawBody, signature);
  } catch {
    return { ok: false as const, status: 400 };
  }
  return { ok: true as const, result: await applyBillingEvent(rt.db, event, rt.prices) };
}

/** Fake mode only: what Stripe would send after a successful test checkout or a portal cancel. */
export async function fakeStripe(kind: "checkout" | "cancel", userId: string, priceId?: string) {
  const rt = await runtime();
  if (!rt.fake || rt.billing?.provider !== "fake") throw new UserError("Not available");
  const fake = rt.billing as FakeBilling;
  const customerId = `cus_fake_${userId}`;
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const n = `${userId}_${now.getTime()}`;
  const sub = await currentSubscription(rt.db, userId);
  const events: BillingEvent[] =
    kind === "checkout"
      ? [
          {
            kind: "checkout_completed",
            eventId: `evt_co_${n}`,
            userId,
            customerId,
            subscriptionId: `sub_fake_${userId}`,
          },
          {
            kind: "subscription_changed",
            eventId: `evt_sc_${n}`,
            userId,
            customerId,
            subscriptionId: `sub_fake_${userId}`,
            priceId,
            status: "active",
            currentPeriodEnd: end,
            cancelAtPeriodEnd: false,
          },
          {
            kind: "invoice_paid",
            eventId: `evt_ip_${n}`,
            userId,
            invoiceId: `in_fake_${n}`,
            customerId,
            subscriptionId: `sub_fake_${userId}`,
            priceId,
            periodStart: now.toISOString(),
            periodEnd: end,
          },
        ]
      : [
          {
            kind: "subscription_changed",
            eventId: `evt_cancel_${n}`,
            userId,
            customerId,
            subscriptionId: `sub_fake_${userId}`,
            priceId: Object.entries(rt.prices).find(([, v]) => v === sub?.plan)?.[0],
            status: "active",
            currentPeriodEnd: sub?.currentPeriodEnd ?? end,
            cancelAtPeriodEnd: true,
          },
        ];
  for (const e of events) {
    const body = JSON.stringify(e);
    await handleWebhook(body, fake.sign(body));
  }
}

/** Everything the Billing page shows. */
export async function billingView(userId: string) {
  const rt = await runtime();
  const sub = await currentSubscription(rt.db, userId);
  const now = new Date().toISOString();
  const nextExpiry = await rt.db
    .select()
    .from(schema.creditGrants)
    .where(
      and(
        eq(schema.creditGrants.ownerId, userId),
        isNull(schema.creditGrants.expiredAt),
        gte(schema.creditGrants.periodEnd, now),
      ),
    )
    .orderBy(asc(schema.creditGrants.periodEnd))
    .limit(1);
  const active = sub && sub.plan && sub.status !== "canceled" ? sub : null;
  return {
    enabled: Boolean(rt.billing),
    plan: active?.plan ? PLANS[PlanId.parse(active.plan)] : null,
    status: active?.status ?? null,
    periodEnd: active?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: active?.cancelAtPeriodEnd ?? false,
    hasCustomer: Boolean(sub),
    shorts: await balance(rt.db, userId, "short"),
    aiVideo: await balance(rt.db, userId, "ai_video_credit"),
    creditsExpireAt: nextExpiry[0]?.periodEnd ?? null,
    available: Object.values(rt.prices),
  };
}

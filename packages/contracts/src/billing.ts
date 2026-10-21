import { z } from "zod";

/** Paid plans sold through Checkout (Agency comes with E11; owner decision 2026-10-18). */
export const PlanId = z.enum(["creator", "pro"]);
export type PlanId = z.infer<typeof PlanId>;

export interface Plan {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  /** Granted on every paid invoice; unused credits expire at the end of that billing period (no rollover). */
  monthlyShorts: number;
  monthlyAiVideoCredits: number;
  /** Publishing channels the plan allows to stay connected (E1-04). */
  maxChannels: number;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  creator: {
    id: "creator",
    name: "Creator",
    priceUsdMonthly: 29,
    monthlyShorts: 30,
    monthlyAiVideoCredits: 0,
    maxChannels: 1,
    features: ["30 Shorts a month", "1 channel", "YouTube publishing", "Daily trend brief (coming soon)"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdMonthly: 79,
    monthlyShorts: 90,
    monthlyAiVideoCredits: 20,
    maxChannels: 3,
    features: ["90 Shorts a month", "3 channels", "20 AI-video credits", "All platforms as they launch"],
  },
};

/** The Free tier (no subscription): 5 signup Shorts and one channel. */
export const FREE_MAX_CHANNELS = 1;

/**
 * How many channels a user may keep connected (E1-04). `plan` is the active paid plan, or null on Free.
 * Admins have no limit; other credit-exempt users (beta access codes) get Pro's allowance.
 */
export function maxChannelsFor(
  plan: PlanId | null,
  access: { admin?: boolean; unlimited?: boolean } = {},
): number {
  if (access.admin) return Number.POSITIVE_INFINITY;
  const paid = plan ? PLANS[plan].maxChannels : FREE_MAX_CHANNELS;
  return access.unlimited ? Math.max(paid, PLANS.pro.maxChannels) : paid;
}

export const SubscriptionStatus = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
  "paused",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/** Provider-neutral billing events (the Stripe adapter maps webhooks onto these). */
export type BillingEvent =
  | {
      kind: "checkout_completed";
      eventId: string;
      userId: string;
      customerId: string;
      subscriptionId?: string;
    }
  | {
      kind: "subscription_changed";
      eventId: string;
      /** Our user id, stamped on the subscription's metadata at checkout (events can arrive in any order). */
      userId?: string;
      customerId: string;
      subscriptionId: string;
      priceId?: string;
      status: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: "invoice_paid";
      eventId: string;
      userId?: string;
      invoiceId: string;
      customerId: string;
      subscriptionId?: string;
      priceId?: string;
      periodStart: string;
      periodEnd: string;
    }
  | { kind: "ignored"; eventId: string; type: string };

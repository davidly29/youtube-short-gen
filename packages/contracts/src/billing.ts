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
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  creator: {
    id: "creator",
    name: "Creator",
    priceUsdMonthly: 29,
    monthlyShorts: 30,
    monthlyAiVideoCredits: 0,
    features: ["30 Shorts a month", "1 channel", "YouTube publishing", "Daily trend brief (coming soon)"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdMonthly: 79,
    monthlyShorts: 90,
    monthlyAiVideoCredits: 20,
    features: ["90 Shorts a month", "3 channels", "20 AI-video credits", "All platforms as they launch"],
  },
};

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

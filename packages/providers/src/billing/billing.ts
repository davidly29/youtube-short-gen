import type { BillingEvent } from "@shortloop/contracts";

export interface CheckoutInput {
  userId: string;
  email: string;
  priceId: string;
  /** Reuse the Stripe customer when the user subscribed before. */
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}

/** Payments behind an interface: Stripe in production, a fake for tests and SHORTLOOP_FAKE_PROVIDERS. */
export interface BillingProvider {
  readonly provider: string;
  /** Hosted checkout page URL for a subscription. */
  checkoutUrl(input: CheckoutInput): Promise<string>;
  /** Hosted page where the customer cancels, upgrades or updates their card. */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** Verify the webhook signature and map the event; throws on a bad signature. */
  parseWebhook(rawBody: string, signature: string): BillingEvent;
}

export class WebhookSignatureError extends Error {}

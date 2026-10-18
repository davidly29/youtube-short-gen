import { createHmac } from "node:crypto";
import type { BillingEvent } from "@shortloop/contracts";
import { WebhookSignatureError, type BillingProvider, type CheckoutInput } from "./billing";

/**
 * Offline billing for tests and SHORTLOOP_FAKE_PROVIDERS. Checkout sends the browser to the app's fake-checkout
 * route, which posts signed BillingEvents to the real webhook endpoint, so the same code path is exercised.
 */
export class FakeBilling implements BillingProvider {
  readonly provider = "fake";
  constructor(private readonly secret = "fake-webhook-secret") {}

  async checkoutUrl(input: CheckoutInput): Promise<string> {
    const q = new URLSearchParams({
      userId: input.userId,
      priceId: input.priceId,
      success: input.successUrl,
    });
    return `/api/stripe/fake-checkout?${q.toString()}`;
  }
  async portalUrl(customerId: string, returnUrl: string): Promise<string> {
    return `/api/stripe/fake-portal?${new URLSearchParams({ customerId, returnUrl }).toString()}`;
  }
  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }
  parseWebhook(rawBody: string, signature: string): BillingEvent {
    if (signature !== this.sign(rawBody)) throw new WebhookSignatureError("bad fake signature");
    return JSON.parse(rawBody) as BillingEvent;
  }
}

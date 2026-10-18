import type { BillingEvent } from "@shortloop/contracts";
import Stripe from "stripe";
import { WebhookSignatureError, type BillingProvider, type CheckoutInput } from "./billing";

const iso = (unix?: number | null) => (unix ? new Date(unix * 1000).toISOString() : undefined);
const id = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id);

/** Map the Stripe events we care about onto provider-neutral BillingEvents. Exported for fixture tests. */
export function mapStripeEvent(event: Stripe.Event): BillingEvent {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      const customerId = id(s.customer);
      if (s.mode !== "subscription" || !s.client_reference_id || !customerId) {
        return { kind: "ignored", eventId: event.id, type: event.type };
      }
      return {
        kind: "checkout_completed",
        eventId: event.id,
        userId: s.client_reference_id,
        customerId,
        subscriptionId: id(s.subscription),
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const item = sub.items.data[0];
      return {
        kind: "subscription_changed",
        eventId: event.id,
        customerId: id(sub.customer) ?? "",
        userId: sub.metadata.userId,
        subscriptionId: sub.id,
        priceId: item?.price.id,
        status: sub.status,
        currentPeriodEnd: iso(item?.current_period_end),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    }
    case "invoice.paid": {
      const inv = event.data.object;
      const line = inv.lines.data.find((l) => l.pricing?.price_details?.price) ?? inv.lines.data[0];
      const details = inv.parent?.subscription_details;
      const subscriptionId = id(details?.subscription);
      if (!inv.id || !subscriptionId || !line)
        return { kind: "ignored", eventId: event.id, type: event.type };
      return {
        kind: "invoice_paid",
        eventId: event.id,
        userId: details?.metadata?.userId,
        invoiceId: inv.id,
        customerId: id(inv.customer) ?? "",
        subscriptionId,
        priceId: id(line.pricing?.price_details?.price),
        periodStart: iso(line.period.start) ?? new Date().toISOString(),
        periodEnd: iso(line.period.end) ?? new Date().toISOString(),
      };
    }
    default:
      return { kind: "ignored", eventId: event.id, type: event.type };
  }
}

export class StripeBilling implements BillingProvider {
  readonly provider = "stripe";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    client?: Stripe,
  ) {
    this.stripe = client ?? new Stripe(secretKey);
  }

  async checkoutUrl(input: CheckoutInput): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: input.priceId, quantity: 1 }],
      client_reference_id: input.userId,
      subscription_data: { metadata: { userId: input.userId } },
      ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("Stripe didn't return a checkout URL");
    return session.url;
  }

  async portalUrl(customerId: string, returnUrl: string): Promise<string> {
    return (await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl }))
      .url;
  }

  parseWebhook(rawBody: string, signature: string): BillingEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (e) {
      throw new WebhookSignatureError((e as Error).message);
    }
    return mapStripeEvent(event);
  }
}

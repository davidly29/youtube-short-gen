export * from "./billing";
export { mapStripeEvent, StripeBilling } from "./stripe";
export { FakeBilling } from "./fake";
import { StripeBilling } from "./stripe";

/** STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET; undefined (billing off) until both are set. */
export function billingFromEnv(env: NodeJS.ProcessEnv = process.env): StripeBilling | undefined {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return undefined;
  return new StripeBilling(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
}

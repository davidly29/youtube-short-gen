import { readFileSync } from "node:fs";
import { join } from "node:path";
import { balance, eq, openDb, schema, type DbHandle } from "@shortloop/db";
import { applyBillingEvent, expireCredits, type PriceMap } from "@shortloop/pipeline";
import { StripeBilling, WebhookSignatureError } from "@shortloop/providers";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SECRET = "whsec_test_fixture_secret";
const stripe = new Stripe("sk_test_unused");
const billing = new StripeBilling("sk_test_unused", SECRET, stripe);
const prices: PriceMap = { price_creator_test: "creator", price_pro_test: "pro" };
const USER = "usr_stripe_test";
const day = 86_400_000;

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../../test/fixtures/stripe", `${name}.json`), "utf8");
/** Deliver a fixture like Stripe does: signed raw body -> parse -> apply. */
const deliver = (name: string, h: DbHandle, now: Date) => {
  const body = fixture(name);
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return applyBillingEvent(h.db, billing.parseWebhook(body, header), prices, now);
};
const periodStart = new Date(1792800000 * 1000);
const periodEnd = new Date(1795478400 * 1000);
const renewalEnd = new Date(1798070400 * 1000);

let h: DbHandle;
beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await h.db.insert(schema.users).values({ id: USER, email: "payer@example.test" });
  await h.db.insert(schema.creditLedger).values({ ownerId: USER, unit: "short", delta: 5, reason: "signup" });
});
afterEach(() => h.close());

const shorts = () => balance(h.db, USER, "short");

describe("Stripe webhooks (E1-03)", () => {
  it("rejects a webhook whose signature doesn't match the body", () => {
    const body = fixture("invoice.paid.first");
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
    expect(() => billing.parseWebhook(body.replace("in_FIRST", "in_FORGED"), header)).toThrow(
      WebhookSignatureError,
    );
    expect(() => billing.parseWebhook(body, "t=1,v1=bad")).toThrow(WebhookSignatureError);
  });

  it("test-mode checkout grants credits once per invoice (webhook replay is idempotent)", async () => {
    const t = new Date(periodStart.getTime() + day);
    expect(await deliver("checkout.session.completed", h, t)).toEqual({ applied: true });
    await deliver("customer.subscription.created", h, t);
    expect(await deliver("invoice.paid.first", h, t)).toEqual({
      applied: true,
      granted: { short: 30, ai_video_credit: 0 },
    });
    expect(await shorts()).toBe(35);

    // Stripe retries / `stripe events resend`: same event id -> no-op.
    expect(await deliver("invoice.paid.first", h, t)).toEqual({ applied: false, skipped: "duplicate event" });
    // A different event for the same invoice still can't grant twice.
    const again = JSON.parse(fixture("invoice.paid.first")) as { id: string };
    again.id = "evt_invoice_1_dup";
    const body = JSON.stringify(again);
    const res = await applyBillingEvent(
      h.db,
      billing.parseWebhook(body, stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET })),
      prices,
      t,
    );
    expect(res.granted).toEqual({ short: 0, ai_video_credit: 0 });
    expect(await shorts()).toBe(35);

    const sub = await h.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.userId, USER) });
    expect(sub).toMatchObject({
      plan: "creator",
      status: "active",
      stripeCustomerId: "cus_TEST123",
      cancelAtPeriodEnd: false,
    });
  });

  it("monthly Shorts don't roll over: unspent ones expire when the next invoice arrives; signup credits stay", async () => {
    const t = new Date(periodStart.getTime() + day);
    await deliver("checkout.session.completed", h, t);
    await deliver("invoice.paid.first", h, t);
    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: USER, unit: "short", delta: -10, reason: "spent:test" }); // 10 Shorts made
    expect(await shorts()).toBe(25);

    await deliver("invoice.paid.renewal", h, new Date(periodEnd.getTime() + 60_000));
    // 20 unspent from month one expired; the 5 signup credits survive; month two adds 30.
    expect(await shorts()).toBe(35);
    const expired = await h.db
      .select()
      .from(schema.creditLedger)
      .where(
        eq(
          schema.creditLedger.reason,
          "expire:" +
            (
              await h.db.query.creditGrants.findFirst({
                where: eq(schema.creditGrants.invoiceId, "in_FIRST"),
              })
            )?.id,
        ),
      );
    expect(expired.map((e) => e.delta)).toEqual([-20]);
  });

  it("cancelled subscription stops new grants but keeps unspent credits to period end", async () => {
    const t = new Date(periodStart.getTime() + day);
    await deliver("checkout.session.completed", h, t);
    await deliver("invoice.paid.first", h, t);
    await deliver("invoice.paid.renewal", h, new Date(periodEnd.getTime() + 60_000));
    expect(await shorts()).toBe(35);

    // Cancel in the Customer Portal: active until period end, credits untouched.
    await deliver("customer.subscription.updated.cancel", h, new Date(periodEnd.getTime() + day));
    expect(
      (await h.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.userId, USER) }))
        ?.cancelAtPeriodEnd,
    ).toBe(true);
    expect(await expireCredits(h.db, new Date(renewalEnd.getTime() - 60_000))).toBe(0);
    expect(await shorts()).toBe(35);

    // Period ends: Stripe deletes the subscription; no more grants, and the month's leftovers expire.
    await deliver("customer.subscription.deleted", h, renewalEnd);
    expect(await deliver("invoice.paid.after-cancel", h, new Date(renewalEnd.getTime() + day))).toEqual({
      applied: false,
      skipped: "subscription cancelled",
    });
    expect(await expireCredits(h.db, new Date(renewalEnd.getTime() + 60_000))).toBe(30);
    expect(await shorts()).toBe(5); // signup credits are never taken away
    expect(await expireCredits(h.db, new Date(renewalEnd.getTime() + 2 * 60_000))).toBe(0); // idempotent
  });

  it("ignores events it doesn't use and invoices for prices it doesn't sell", async () => {
    const other = JSON.stringify({
      ...JSON.parse(fixture("invoice.paid.first")),
      id: "evt_other",
      type: "charge.refunded",
    });
    const res = await applyBillingEvent(
      h.db,
      billing.parseWebhook(
        other,
        stripe.webhooks.generateTestHeaderString({ payload: other, secret: SECRET }),
      ),
      prices,
      new Date(),
    );
    expect(res).toEqual({ applied: false, skipped: "ignored charge.refunded" });
    const res2 = await applyBillingEvent(
      h.db,
      billing.parseWebhook(
        fixture("invoice.paid.first"),
        stripe.webhooks.generateTestHeaderString({ payload: fixture("invoice.paid.first"), secret: SECRET }),
      ),
      {},
      new Date(periodStart.getTime() + day),
    );
    expect(res2.skipped).toMatch(/unknown price/);
    expect(await shorts()).toBe(5);
  });
});

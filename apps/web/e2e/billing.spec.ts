import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("E1-03 Stripe subscriptions (fake Stripe)", () => {
  test("subscribe to Creator: checkout grants this month's Shorts once; cancelling keeps them to period end", async ({
    page,
  }) => {
    await signUp(page);
    await page.getByTestId("credits").click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByTestId("plan-name")).toHaveText("Free");
    await expect(page.getByTestId("billing-shorts")).toContainText("5");

    await page.getByTestId("subscribe-creator").click();
    await expect(page.getByTestId("checkout-success")).toBeVisible();
    await expect(page.getByTestId("plan-name")).toHaveText("Creator");
    await expect(page.getByTestId("plan-renewal")).toContainText("Renews");
    await expect(page.getByTestId("billing-shorts")).toContainText("35");
    await expect(page.getByTestId("credits")).toContainText("35 Shorts left");
    await expect(page.getByTestId("subscribe-pro")).toHaveCount(0); // one plan at a time; change it in the portal

    await page.reload(); // reloading the success page must not grant again
    await expect(page.getByTestId("billing-shorts")).toContainText("35");

    await page.getByTestId("manage").click();
    await expect(page.getByTestId("plan-renewal")).toContainText("Cancelled: active until");
    await expect(page.getByTestId("billing-shorts")).toContainText("35");
  });

  test("the webhook endpoint rejects unsigned or forged events", async ({ request }) => {
    const forged = await request.post("/api/stripe/webhook", {
      data: JSON.stringify({ kind: "invoice_paid", eventId: "evt_forged" }),
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=nope" },
    });
    expect(forged.status()).toBe(400);
  });
});

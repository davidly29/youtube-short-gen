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

test.describe("E1-04 channel limits per plan (fake Stripe + fake YouTube)", () => {
  test("Free allows one channel, Pro three; after a downgrade the user picks which channels stay active", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();
    // Free: the connect button gives way to an upgrade link, and the server refuses a direct attempt too.
    await expect(page.getByTestId("connect-youtube")).toHaveCount(0);
    await expect(page.getByTestId("channel-limit")).toContainText("Free plan includes 1 channel");
    await expect(page.getByTestId("upgrade-link")).toHaveAttribute("href", "/billing");
    await page.goto("/api/channels/youtube/start");
    await expect(page).toHaveURL(/\/channels\?error=/);
    await expect(
      page.getByText("Your Free plan includes 1 channel. Upgrade on the Billing page"),
    ).toBeVisible();

    await page.goto("/billing");
    await page.getByTestId("subscribe-pro").click();
    await expect(page.getByTestId("plan-name")).toHaveText("Pro");
    await page.goto("/channels");
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("connect-youtube").click();
      await expect(page.getByTestId("connected-banner")).toBeVisible();
    }
    await expect(page.getByTestId("channel-list").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("channel-limit")).toContainText("Pro plan includes 3 channels"); // no fourth

    // Downgrade to Creator in the (fake) portal: all three stay connected, but none publishes until the user picks.
    await page.goto("/api/stripe/fake-portal?changeTo=price_creator_fake&returnUrl=/channels");
    await expect(page.getByTestId("choose-active")).toContainText("Creator plan includes 1 channel");
    await expect(page.getByTestId("channel-paused")).toHaveCount(3);
    const boxes = page.getByTestId("choose-active").locator('input[type="checkbox"]');
    await boxes.nth(1).check();
    await expect(boxes.nth(0)).toBeDisabled(); // one pick fills the Creator allowance
    await page.getByTestId("save-active").click();
    await expect(page.getByTestId("channel-paused")).toHaveCount(2);
    await expect(page.getByTestId("channel-list").locator("li")).toHaveCount(3);
  });
});

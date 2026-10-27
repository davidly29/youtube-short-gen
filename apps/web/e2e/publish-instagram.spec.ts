import { expect, test } from "@playwright/test";
import { makeShort, signUp } from "./helpers";

/** E8-04b: connect an Instagram Professional account and publish an approved Short as a Reel (fake Instagram). */
test.describe("E8-04b: Instagram Reels", () => {
  test("connect, post a Reel, see its permalink", async ({ page }) => {
    await signUp(page);
    await makeShort(page);
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("publish-panel")).toBeVisible();
    await page.getByTestId("post-to-instagram").click();
    await expect(page).toHaveURL(/\/publish\/instagram\?project=prj_/);

    await page.getByTestId("connect-instagram").click();
    await expect(page.getByTestId("instagram-connected-banner")).toBeVisible();
    await expect(page.getByTestId("instagram-username")).toContainText("@fake.reels");
    await expect(page.getByTestId("instagram-preview")).toBeVisible();

    await page.getByLabel("Caption").fill("Why octopuses have three hearts #ocean");
    await page.getByTestId("instagram-post").click();
    // The worker polls Instagram's processing, then publishes; the page refreshes until it settles.
    await expect(page.getByTestId("instagram-publishes")).toContainText("Posted", { timeout: 60_000 });
    await expect(page.getByTestId("instagram-link")).toHaveAttribute(
      "href",
      /^https:\/\/www\.instagram\.com\/reel\//,
    );
    // Posted once: the form is gone for this account.
    await expect(page.getByTestId("instagram-form")).toHaveCount(0);

    // The account shows on Channels and can be disconnected there.
    await page.goto("/channels");
    await expect(page.getByTestId("channel-list")).toContainText("@fake.reels");
    await expect(page.getByTestId("channel-list")).toContainText("Instagram");
    await page.getByRole("button", { name: /Disconnect/ }).click();
    await expect(page.getByTestId("no-channels")).toBeVisible();
  });

  test("a forged Instagram OAuth callback is refused", async ({ page }) => {
    await signUp(page);
    await page.goto("/publish/instagram/callback?code=fake-code-x&state=forged");
    await expect(page).toHaveURL(/\/channels\?error=/);
    await expect(page.getByTestId("no-channels")).toBeVisible();
  });
});

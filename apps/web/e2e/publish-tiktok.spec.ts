import { expect, test } from "@playwright/test";
import { makeShort, signUp } from "./helpers";

/**
 * E8-03: the TikTok post form follows TikTok's content-sharing guidelines (docs/tiktok-audit.md). The e2e server
 * runs unaudited (no TIKTOK_AUDITED), so every post must be private.
 */
test.describe("E8-03: TikTok Direct Post", () => {
  test("connect, fill the guideline form, post privately while unaudited", async ({ page }) => {
    await signUp(page);
    await makeShort(page);
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("publish-panel")).toBeVisible();
    await page.getByTestId("post-to-tiktok").click();
    await expect(page).toHaveURL(/\/publish\/tiktok\?project=prj_/);

    // Unaudited: the UI says posts will be private before anything else.
    await expect(page.getByTestId("unaudited-notice")).toContainText("Posts will be private");
    await expect(page.getByText("No ShortLoop watermark")).toBeVisible();

    await page.getByTestId("connect-tiktok").click();
    await expect(page.getByTestId("tiktok-connected-banner")).toBeVisible();
    // creator_info: the account's nickname is shown before posting.
    await expect(page.getByTestId("tiktok-creator")).toContainText("Fake Creator");
    await expect(page.getByTestId("tiktok-preview")).toBeVisible();

    const post = page.getByTestId("tiktok-post");
    const problems = page.getByTestId("tiktok-problems");
    // No default visibility; Post stays disabled until the user picks one and consents.
    const privacy = page.getByLabel("Who can view this video");
    await expect(privacy).toHaveValue("");
    await expect(post).toBeDisabled();
    await expect(problems).toContainText("Choose who can view this video.");
    // While unaudited only "Only me" can be picked.
    await expect(privacy.locator("option", { hasText: "Everyone" })).toBeDisabled();
    await expect(privacy.locator("option", { hasText: "Only me" })).toBeEnabled();

    // Interactions: off by default; the creator turned Stitch off, so it can't be switched on.
    await expect(page.getByLabel("Comment")).not.toBeChecked();
    await expect(page.getByLabel("Duet")).not.toBeChecked();
    await expect(page.getByLabel(/Stitch/)).toBeDisabled();

    // Commercial content disclosure: off by default; on requires a choice and shows the label TikTok will add.
    const disclose = page.getByRole("switch", { name: "Disclose video content" });
    await expect(disclose).not.toBeChecked();
    await disclose.check();
    await expect(problems).toContainText("promotes yourself, a third party, or both");
    await page.getByLabel(/Your brand/).check();
    await expect(page.getByTestId("commercial-label")).toContainText("Promotional content");
    await page.getByLabel(/Branded content/).check();
    await expect(page.getByTestId("commercial-label")).toContainText("Paid partnership");
    await expect(page.getByTestId("tiktok-declaration")).toContainText("Branded Content Policy");
    // Branded content can't be private.
    await expect(privacy.locator("option", { hasText: "Only me" })).toBeDisabled();
    await disclose.uncheck();
    await expect(page.getByTestId("tiktok-declaration")).not.toContainText("Branded Content Policy");
    await expect(page.getByTestId("tiktok-declaration")).toContainText("Music Usage Confirmation");

    await page.getByLabel("Caption").fill("Why octopuses have three hearts #ocean");
    await privacy.selectOption("SELF_ONLY");
    await page.getByLabel("Comment").check();
    await expect(post).toBeDisabled();
    await page.getByTestId("tiktok-declaration").getByRole("checkbox").check();
    await expect(post).toBeEnabled();
    await post.click();

    await expect(page.getByTestId("tiktok-publishes")).toContainText(/Processing on TikTok|Posted/, {
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.getByTestId("tiktok-publishes")).toContainText("Posted");
    await expect(page.getByTestId("tiktok-private-done")).toBeVisible();
    // Posted once: the form is gone for this account.
    await expect(page.getByTestId("tiktok-form")).toHaveCount(0);

    // The account shows on Channels with its platform, and can be disconnected there.
    await page.goto("/channels");
    await expect(page.getByTestId("channel-list")).toContainText("Fake Creator");
    await expect(page.getByTestId("channel-list")).toContainText("TikTok");
    await page.getByRole("button", { name: /Disconnect/ }).click();
    await expect(page.getByTestId("no-channels")).toBeVisible();
  });

  test("a forged TikTok OAuth callback is refused", async ({ page }) => {
    await signUp(page);
    await page.goto("/publish/tiktok/callback?code=fake-code-x&state=forged");
    await expect(page).toHaveURL(/\/channels\?error=/);
    await expect(page.getByTestId("no-channels")).toBeVisible();
  });
});

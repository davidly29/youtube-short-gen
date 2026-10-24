import { expect, test } from "@playwright/test";
import { makeShort, signUp } from "./helpers";

test.describe("E8-01 + E8-02 + E10-01: connect a channel, publish, see stats, schedule", () => {
  test("connect YouTube (fake OAuth), publish an approved Short, refuse a second upload, see its stats, disconnect", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/channels");
    await expect(page.getByTestId("no-channels")).toBeVisible();
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();
    await expect(page.getByTestId("channel-list")).toContainText("Fake Channel");

    await makeShort(page);
    const project = page.url();
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("publish-panel")).toBeVisible();
    await page.getByLabel("Tags (comma separated)").fill("octopus, ocean facts");
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("published-link")).toHaveAttribute(
      "href",
      /youtube\.com\/shorts\/fakevid\d+/,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("publishes")).toContainText("Published");

    // That channel is done: the form no longer offers it (the server refuses a second upload too).
    await expect(page.getByTestId("all-published")).toBeVisible();

    // E10-01: the dashboard card shows views and retention per published Short (fake YouTube Analytics).
    await page.goto("/projects");
    await expect(page.getByTestId("performance-card")).toBeVisible();
    await page.getByTestId("refresh-stats").click();
    const row = page.getByTestId("stats-row").first();
    await expect(row.getByTestId("stats-views")).toHaveText(/^\d[\d.,]*K?$/, { timeout: 30_000 });
    await expect(row.getByTestId("stats-retention")).toHaveText(/^\d+\.\d%$/);
    await expect(row).toContainText("Fake Channel");

    await page.goto("/channels");
    await page.getByRole("button", { name: /Disconnect/ }).click();
    await expect(page.getByTestId("no-channels")).toBeVisible();
    await page.goto(project);
    await expect(page.getByTestId("no-channel-hint")).toBeVisible();
  });

  test("schedule a post for later", async ({ page }) => {
    await signUp(page);
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await makeShort(page);
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("publish-panel")).toBeVisible();
    await page.getByLabel("Schedule", { exact: true }).check();
    const local = new Date(Date.now() + 2 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page
      .getByLabel("Publish at")
      .fill(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`);
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("publishes")).toContainText("Scheduled", { timeout: 60_000 });
    await expect(page.getByTestId("published-link")).toContainText("Goes live");
  });

  test("a forged OAuth callback (wrong state) is refused", async ({ page }) => {
    await signUp(page);
    await page.goto("/api/channels/youtube/callback?code=fake-code&state=forged");
    await expect(page).toHaveURL(/\/channels\?error=/);
    await expect(page.getByTestId("no-channels")).toBeVisible();
  });
});

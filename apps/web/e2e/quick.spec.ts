import { expect, test } from "@playwright/test";
import { addKey, signUp } from "./helpers";

test.describe("Quick Short: topic to finished video in one click", () => {
  test("without an AI key, Make my Short explains what's needed and step by step still works", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/new");
    await expect(page.getByTestId("quick-create")).toBeDisabled();
    await expect(page.getByTestId("quick-needs-key")).toContainText("AI key");
    await expect(page.getByRole("button", { name: /Continue to script/ })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current", "page");
  });

  test("pick a format, choose captions, and Make my Short renders it without stopping", async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page);
    await addKey(page, "gemini", "test-gemini-key-quick");
    await page.getByRole("link", { name: "New Short" }).click();
    await page.getByLabel("Topic").fill("Why octopuses have three hearts");

    // A format fills in the angle; picking another replaces it; the user's own angle is kept.
    await page.getByRole("button", { name: "Myth vs fact" }).click();
    await expect(page.getByLabel("Angle (optional)")).toHaveValue(/myth/i);
    await page.getByRole("button", { name: "Top 3" }).click();
    await expect(page.getByLabel("Angle (optional)")).toHaveValue(/three most surprising/);
    await page.getByRole("radio", { name: "30s" }).click();

    await page.getByTestId("quick-style").locator("summary").click();
    await page.getByRole("radio", { name: "Karaoke captions" }).click();
    await page.getByTestId("quick-create").click();

    await expect(page).toHaveURL(/\/projects\/prj_/);
    await expect(page.getByTestId("player")).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId("project-title")).not.toBeEmpty();
    await expect(page.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });
});

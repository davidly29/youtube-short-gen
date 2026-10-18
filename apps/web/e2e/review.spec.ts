import { expect, test } from "@playwright/test";
import { makeShort, signUp } from "./helpers";

test.describe("E7-02 preview and fix", () => {
  test("swap a visual, fix a caption, re-render, approve", async ({ page }) => {
    await signUp(page);
    await makeShort(page);
    const src = await page.getByTestId("player").getAttribute("src");

    await page.getByRole("button", { name: "Swap visual 1" }).click();
    await expect(page.getByTestId("alternatives")).toBeVisible();
    await page.getByTestId("swap-ai").click();
    await expect(page.getByTestId("player")).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => page.getByTestId("player").getAttribute("src"), { timeout: 90_000 })
      .not.toBe(src);

    const first = page.getByLabel("Caption word 1", { exact: true });
    await first.fill("OCTOPI");
    await page.getByRole("button", { name: "Apply and re-render" }).click();
    await expect(page.getByLabel("Caption word 1", { exact: true })).toHaveValue("OCTOPI", {
      timeout: 90_000,
    });
    await expect(page.getByTestId("player")).toBeVisible({ timeout: 90_000 });

    // Re-renders are free: still one credit used.
    await expect(page.getByTestId("credits")).toHaveText(/4 Shorts left/);
    await expect(page.getByTestId("approve")).toBeEnabled();
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("approved")).toBeVisible();
  });
});

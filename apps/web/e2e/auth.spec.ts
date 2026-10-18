import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("E1-01 sign-in and workspace", () => {
  test("a new user lands on an empty project list with 5 free Shorts", async ({ page }) => {
    const email = await signUp(page);
    await expect(page.getByTestId("empty-projects")).toBeVisible();
    // The +5 `signup` grant in credit_ledger is what this balance is summed from.
    await expect(page.getByTestId("credits")).toHaveText(/5 Shorts left/);

    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/sign-in|\/$/);
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("credits")).toHaveText(/5 Shorts left/); // granted once, not per sign-in
  });

  test("wrong password is rejected", async ({ page }) => {
    const email = await signUp(page);
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("main").getByRole("alert")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

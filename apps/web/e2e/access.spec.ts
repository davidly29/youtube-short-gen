import { expect, test, type Page } from "@playwright/test";

/** Sign up through the form, optionally with a beta access code. */
async function signUpWith(page: Page, email: string, code?: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  if (code) await page.getByLabel("Beta access code (optional)").fill(code);
  await page.getByRole("button", { name: "Create account" }).click();
}
const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

test.describe("Admin and beta access codes", () => {
  test("a valid code at sign-up gives unlimited Shorts; the code runs out after its limit", async ({
    browser,
  }) => {
    const a = await browser.newPage();
    await signUpWith(a, unique("beta-a"), "betatest1"); // case-insensitive
    await expect(a).toHaveURL(/\/projects$/);
    await expect(a.getByTestId("credits")).toHaveText(/Unlimited/);
    await a.goto("/billing");
    await expect(a.getByTestId("plan-name")).toHaveText("Beta access");
    await expect(a.getByTestId("unlimited")).toBeVisible();
    await expect(a.getByTestId("access-code")).toHaveCount(0);
    await expect(a.getByTestId("admin-link")).toHaveCount(0);
    expect((await a.goto("/admin"))?.status()).toBe(404);

    const b = await browser.newPage();
    await signUpWith(b, unique("beta-b"), "BETATEST1");
    await expect(b.getByTestId("credits")).toHaveText(/Unlimited/);

    const c = await browser.newPage(); // limit is 2 in the e2e config
    await signUpWith(c, unique("beta-c"), "BETATEST1");
    await expect(c).toHaveURL(/\/billing\?error=/);
    await expect(c.getByRole("alert").first()).toContainText("fully used");
    await expect(c.getByTestId("credits")).toHaveText(/5 Shorts left/);
  });

  test("a wrong code is refused on the Billing page", async ({ page }) => {
    await signUpWith(page, unique("nocode"));
    await expect(page).toHaveURL(/\/projects$/);
    await page.goto("/billing");
    await page.getByLabel("Access code").fill("NOT-A-CODE");
    await page.getByRole("button", { name: "Redeem" }).click();
    await expect(page.getByTestId("access-code").getByRole("alert")).toContainText("isn't valid");
    await expect(page.getByTestId("credits")).toHaveText(/5 Shorts left/);
  });

  test("an email in ADMIN_EMAILS is admin: unlimited, and sees the admin page", async ({ page }) => {
    await signUpWith(page, "owner-e2e@example.test");
    await expect(page.getByTestId("credits")).toHaveText(/Unlimited/);
    await page.getByTestId("admin-link").click();
    await expect(page.getByTestId("admin")).toBeVisible();
    await expect(page.getByTestId("admin-codes")).toContainText("BETATEST1");
    await expect(page.getByTestId("admin-users")).toContainText("owner-e2e@example.test");
    await page.goto("/billing");
    await expect(page.getByTestId("plan-name")).toHaveText("Admin");
  });
});

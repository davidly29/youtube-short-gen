import { expect, test } from "@playwright/test";
import { addKey, signUp } from "./helpers";

test.describe("BYOK: users bring their own API keys", () => {
  test("without a key AI scripts are off; adding a Gemini key turns them on; removing it turns them off", async ({
    page,
  }) => {
    await signUp(page);
    await page.getByRole("link", { name: "New Short" }).click();
    await page.getByLabel("Topic").fill("How volcanoes make islands");
    await page.getByRole("button", { name: /Continue to script/ }).click();
    await expect(page.getByTestId("ai-script")).toBeDisabled();
    await expect(page.getByTestId("needs-key")).toBeVisible();
    const project = page.url();

    await page.getByTestId("needs-key").getByRole("link").click();
    await expect(page).toHaveURL(/\/settings\/keys$/);
    await expect(page.getByTestId("in-use")).toContainText("Add a Gemini, Claude or OpenAI key");

    await addKey(page, "gemini", "wrong-key-12345678");
    await expect(page.getByTestId("key-gemini").getByRole("alert")).toContainText("rejected this key");
    await expect(page.getByTestId("key-gemini-status")).toHaveText("Not connected");

    await page
      .getByTestId("key-gemini")
      .getByLabel(/API key/)
      .fill("test-gemini-secret-9876");
    await page.getByTestId("key-gemini-save").click();
    await expect(page.getByTestId("key-gemini-status")).toContainText("Connected ••••9876");
    await page.reload();
    await expect(page.getByTestId("in-use")).toContainText("Google Gemini · your key");
    expect(await page.content()).not.toContain("test-gemini-secret-9876"); // only ever shown masked

    await page.goto(project);
    await expect(page.getByTestId("ai-script")).toBeEnabled();
    await page.getByTestId("ai-script").click();
    await expect(page.getByTestId("script-editor")).toBeVisible({ timeout: 30_000 });

    await page.goto("/settings/keys");
    await page.getByTestId("key-gemini-remove").click();
    await expect(page.getByTestId("key-gemini-status")).toHaveText("Not connected");
    await page.reload();
    await expect(page.getByTestId("in-use")).toContainText("Add a Gemini, Claude or OpenAI key");
  });

  test("keys belong to one user: another account doesn't see or use them", async ({ page, browser }) => {
    await signUp(page);
    await addKey(page, "pexels", "test-pexels-key-1111");
    await expect(page.getByTestId("key-pexels-status")).toContainText("••••1111");

    const other = await browser.newPage();
    await signUp(other);
    await other.goto("/settings/keys");
    await expect(other.getByTestId("key-pexels-status")).toHaveText("Not connected");
    await expect(other.getByTestId("in-use")).toContainText("Optional: add Pexels or Pixabay");
    await other.close();
  });
});

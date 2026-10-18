import { expect, type Page } from "@playwright/test";

export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Creator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  return email;
}

/** Save a key in Settings -> API keys. With fake providers, keys starting `test-` pass the check. */
export async function addKey(page: Page, provider: string, key: string) {
  await page.goto("/settings/keys");
  await page.getByTestId(`key-${provider}-add`).click();
  await page
    .getByTestId(`key-${provider}`)
    .getByLabel(/API key/)
    .fill(key);
  await page.getByTestId(`key-${provider}-save`).click();
}

/** Topic -> AI script (fake LLM) -> saved script -> "Make my Short" -> rendered preview. */
export async function makeShort(page: Page, topic = "Why octopuses have three hearts") {
  await addKey(page, "gemini", "test-gemini-key-0001");
  await expect(page.getByTestId("key-gemini-status")).toContainText("••••0001");
  await page.getByRole("link", { name: "New Short" }).click();
  await page.getByLabel("Topic").fill(topic);
  await page.getByRole("radio", { name: "30s" }).click();
  await page.getByRole("button", { name: /Continue to script/ }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  await page.getByTestId("ai-script").click();
  await expect(page.getByTestId("script-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("style-panel")).toBeVisible();
  await page.getByRole("button", { name: "Karaoke" }).click();
  await page.getByTestId("make-short").click();
  await expect(page.getByTestId("player")).toBeVisible({ timeout: 90_000 });
}

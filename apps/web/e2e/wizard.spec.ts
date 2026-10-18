import { expect, test } from "@playwright/test";
import { makeShort, signUp } from "./helpers";

test.describe("E7-01 create-a-Short wizard", () => {
  test("topic -> AI script -> style -> rendered preview in under 60 s, charging one credit", async ({
    page,
  }) => {
    await signUp(page);
    const started = Date.now();
    await makeShort(page);
    expect(Date.now() - started).toBeLessThan(60_000);
    await expect(page.getByTestId("credits")).toHaveText(/4 Shorts left/);
    await expect(page.getByTestId("rights")).toContainText("ai generated");
    await page.goto("/projects");
    await expect(page.getByText("Why octopuses have three hearts")).toBeVisible();
  });

  test("a hand-written script works without AI and shows the word budget", async ({ page }) => {
    await signUp(page);
    await page.getByRole("link", { name: "New Short" }).click();
    await page.getByLabel("Topic").fill("The tallest tree on Earth");
    await page.getByRole("button", { name: /Continue to script/ }).click();
    await page.getByRole("button", { name: /I’ll write it/ }).click();
    const lines = [
      ["Meet the tallest living thing on the planet, hiding in a California forest.", "giant redwood forest"],
      [
        "It is a coast redwood called Hyperion, taller than a thirty storey building.",
        "redwood trunk looking up",
      ],
      [
        "Its exact location is kept secret to protect the roots from trampling visitors.",
        "forest trail sign",
      ],
    ];
    for (const [i, [text, visual]] of lines.entries()) {
      await page.getByLabel(`Beat ${i + 1} narration`).fill(text);
      await page.getByLabel(`Beat ${i + 1} visual`).fill(visual);
    }
    await expect(page.getByTestId("word-count")).toContainText("/");
    await page.getByTestId("save-script").click();
    await expect(page.getByTestId("style-panel")).toBeVisible();
    await page.getByTestId("make-short").click();
    await expect(page.getByTestId("player")).toBeVisible({ timeout: 90_000 });
  });
});

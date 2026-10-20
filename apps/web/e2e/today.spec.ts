import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("E3-03b: Today page and niche picker", () => {
  test("pick a niche, see the brief, and turn an angle into a Short that remembers its topic", async ({
    page,
  }) => {
    await signUp(page);
    await page.getByRole("link", { name: "Today" }).click();
    await expect(page.getByTestId("today-no-channels")).toBeVisible();

    // Connect a channel (fake OAuth); Today then asks for its niche.
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();
    await page.goto("/today");
    await page.getByLabel("Niche").selectOption("history");
    await page.getByTestId("save-niche").click();
    await expect(page.getByTestId("brief-pending")).toContainText(
      "Your first brief arrives tomorrow morning",
    );

    // The niche is saved on the channel (Channels shows it too, after a reload).
    await page.goto("/channels");
    await expect(page.getByTestId("channel-niches").getByLabel("Niche")).toHaveValue("history");

    // The 05:00 UTC job's output, seeded in fake mode.
    const seeded = await page.request.post("/today/seed");
    expect(seeded.ok()).toBe(true);
    await page.goto("/today");
    const items = page.getByTestId("brief-item");
    await expect(items).toHaveCount(3);
    const first = items.first();
    await expect(first).toContainText("Viking Shipwreck Discovered: here's what changed this week");
    await expect(first.getByRole("link", { name: /example source/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );

    await first.getByTestId("make-this-short").click();
    await expect(page).toHaveURL(/\/new\?.*topicId=top_fake_0/);
    await expect(page.getByLabel("Topic")).toHaveValue("Viking Shipwreck Discovered (example source)");
    await expect(page.getByLabel("Angle (optional)")).toHaveValue(
      'Why "Viking Shipwreck Discovered" is trending',
    );
    await page.getByRole("button", { name: /Continue to script/ }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    const projectUrl = new URL(page.url()).pathname;

    // The project stored the topicId: Today now links that item to it instead of offering it again.
    await page.goto("/today");
    const started = page.getByTestId("brief-item").first().getByTestId("brief-item-started");
    await expect(started).toHaveAttribute("href", projectUrl);
    await expect(page.getByTestId("make-this-short")).toHaveCount(2);
  });
});

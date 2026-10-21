import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("E4-03: channel voice profile", () => {
  test("learn the voice from the creator's own videos, edit it in Settings, and pick it for a Short", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/settings/voice");
    await expect(page.getByTestId("voice-no-channels")).toBeVisible();

    // Connect a channel (fake OAuth with 12 fake uploads), then learn its voice.
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();
    await page.goto("/settings/keys");
    await page.getByRole("link", { name: "Channel voice" }).click();
    await expect(page).toHaveURL(/\/settings\/voice$/);
    await expect(page.getByTestId("voice-status")).toHaveText("Not learned yet.");
    await page.getByTestId("build-voice").click();
    await expect(page.getByTestId("voice-status")).toContainText("Learned from 12 of your videos");
    await expect(page.getByLabel(/Words you use/)).toHaveValue(/legion/);

    // Edit: add a banned phrase. It survives a reload.
    const banned = page.getByTestId("voice-banned");
    await banned.fill(`${await banned.inputValue()}\nfun fact`);
    await page.getByTestId("save-voice").click();
    await expect(page.getByTestId("voice-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("voice-banned")).toHaveValue(/fun fact$/);
    await expect(page.getByTestId("voice-status")).toContainText("edited");

    // New Short offers the channel's voice, preselected.
    await page.goto("/new");
    await expect(page.getByTestId("voice-select")).toHaveValue(/^ch_/);
    await page.getByLabel("Topic").fill("Why the Roman legion built roads");
    await page.getByRole("button", { name: /Continue to script/ }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);

    // Switched off: no longer offered.
    await page.goto("/settings/voice");
    await page.getByTestId("voice-enabled").uncheck();
    await expect(page.getByTestId("voice-enabled")).not.toBeChecked();
    await page.goto("/new");
    await expect(page.getByLabel("Topic")).toBeVisible();
    await expect(page.getByTestId("voice-select")).toHaveCount(0);
  });
});

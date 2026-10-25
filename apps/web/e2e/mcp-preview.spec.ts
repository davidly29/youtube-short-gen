import { expect, test } from "@playwright/test";

// The MCP App view, driven by a stub host (the View SDK import is served locally): no network.
import { EXT_APPS_URL, previewHtml } from "@shortloop/mcp";

test("MCP-03: the in-chat preview renders a job, then the finished Short", async ({ page }) => {
  await page.route(EXT_APPS_URL, (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export class App { async connect() {
        this.ontoolresult({ structuredContent: { project_id: "p", job_id: "j", status: "producing", progress: 0.5, done: false, app_url: "https://app.test/projects/p" } });
        setTimeout(() => this.ontoolresult({ structuredContent: { project_id: "p", title: "Why octopuses have three hearts", status: "ready", video_url: "https://app.test/v.mp4", app_url: "https://app.test/projects/p" } }), 300);
      } openLink() {} callServerTool() {} }`,
    }),
  );
  await page.route("https://app.test/**", (r) => r.fulfill({ status: 404 }));
  await page.goto("about:blank");
  await page.setContent(previewHtml());
  await expect(page.locator("#status")).toHaveText("Making video");
  await expect(page.locator("#refresh")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("Ready to review");
  await expect(page.locator("#title")).toHaveText("Why octopuses have three hearts");
  await expect(page.locator("video")).toHaveAttribute("src", "https://app.test/v.mp4");
  await expect(page.locator("#open")).toBeVisible();
});

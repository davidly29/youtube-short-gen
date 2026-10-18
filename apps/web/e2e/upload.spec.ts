import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "e2e-upload-"));
const png = join(dir, "octopus reef.png");
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=540x960",
  "-frames:v",
  "1",
  png,
]);

test.describe("E2-01 upload with ownership attestation", () => {
  test("server rejects missing attestation, wrong types and files over 2 GB", async ({ page }) => {
    await signUp(page);
    const post = (data: object) => page.request.post("/api/uploads", { data });
    const noAttest = await post({ filename: "a.mp4", contentType: "video/mp4", size: 100, attested: false });
    expect(noAttest.status()).toBe(400);
    expect((await noAttest.json()).error).toMatch(/own or have rights/);
    const gif = await post({ filename: "a.gif", contentType: "image/gif", size: 100, attested: true });
    expect(gif.status()).toBe(400);
    expect((await gif.json()).error).toMatch(/MP4, MOV, PNG, JPG, MP3 or WAV/);
    const huge = await post({
      filename: "a.mp4",
      contentType: "video/mp4",
      size: 2 * 1024 ** 3 + 1,
      attested: true,
    });
    expect(huge.status()).toBe(400);
    expect((await huge.json()).error).toMatch(/2 GB/);
    const complete = await page.request.post("/api/uploads/complete", {
      data: { key: "uploads/someone-else/x.png", filename: "x.png", attested: true },
    });
    expect(complete.status()).toBe(400);
  });

  test("the browser refuses unsupported files before uploading", async ({ page }) => {
    await signUp(page);
    await page.goto("/library");
    await page.getByTestId("attest").check();
    const bad = join(dir, "notes.txt");
    writeFileSync(bad, "hello");
    await page.getByTestId("file-input").setInputFiles(bad);
    await expect(page.locator("main").getByRole("alert")).toContainText("isn't a supported file");
  });

  test("an attested PNG uploads, is probed and appears in the library as owned", async ({ page }) => {
    await signUp(page);
    await page.goto("/library");
    await expect(page.getByTestId("empty-library")).toBeVisible();
    await page.getByTestId("attest").check();
    await page.getByTestId("file-input").setInputFiles(png);
    await expect(page.getByTestId("library-grid")).toContainText("octopus reef", { timeout: 30_000 });
    await expect(page.getByTestId("library-grid")).toContainText("540×960");
  });
});

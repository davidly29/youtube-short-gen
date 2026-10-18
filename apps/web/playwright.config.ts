import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * E2E runs the real Next.js app with fake AI providers (SHORTLOOP_FAKE_PROVIDERS=1), an in-memory
 * PGlite database and local storage, so no network or keys are needed. Jobs run in-process.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD ? "" : "pnpm exec next build && "}pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      SHORTLOOP_FAKE_PROVIDERS: "1",
      DATABASE_URL: "memory://",
      STORAGE_DIR: ".e2e-storage",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-1234",
      REDIS_URL: "",
      AUTH_RATE_LIMIT: "off",
    },
  },
});

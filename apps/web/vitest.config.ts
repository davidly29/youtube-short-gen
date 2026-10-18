import { defineConfig } from "vitest/config";

// Unit tests only; Playwright owns e2e/ (`pnpm -F web e2e`).
// Billing tests migrate a fresh in-memory Postgres per test, which is slow when every package tests in parallel.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});

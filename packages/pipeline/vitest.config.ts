import { defineConfig } from "vitest/config";

// PGlite migrations are slower when every package's tests run in parallel.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });

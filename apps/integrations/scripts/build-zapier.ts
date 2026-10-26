/**
 * Bundle the Zapier app into dist/zapier, ready for `zapier push` (pnpm -F integrations build:zapier).
 * The bundle is plain CommonJS with no dependencies besides zapier-platform-core, which Zapier's runtime needs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { APP_VERSION, ZAPIER_PLATFORM_VERSION } from "../src/zapier/app";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "zapier");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src", "zapier", "entry.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(out, "index.js"),
  logLevel: "warning",
});

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "shortloop-zapier",
      version: APP_VERSION,
      description: "ShortLoop for Zapier (built from apps/integrations; do not edit)",
      main: "index.js",
      private: true,
      engines: { node: ">=22" },
      dependencies: { "zapier-platform-core": ZAPIER_PLATFORM_VERSION },
    },
    null,
    2,
  ) + "\n",
);
console.log(`built dist/zapier (app ${APP_VERSION}, platform ${ZAPIER_PLATFORM_VERSION})`);

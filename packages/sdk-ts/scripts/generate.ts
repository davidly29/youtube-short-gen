/**
 * Regenerate both SDKs from docs/api/openapi.yaml (E12-02):
 *   packages/sdk-ts/src/generated.ts and packages/sdk-py/shortloop/_generated.py
 * Usage: pnpm -F sdk-ts generate (after `pnpm -F web openapi` changes the spec).
 */
import { writeFileSync } from "node:fs";
import { generateAll } from "./sources";

for (const file of await generateAll()) {
  writeFileSync(file.path, file.contents);
  console.log(`wrote ${file.path}`);
}

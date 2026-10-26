/** Write the Make app blocks to apps/integrations/make/ (pnpm -F integrations build:make). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFiles } from "../src/make/files";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "make");
for (const [name, content] of Object.entries(await makeFiles(dir))) {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), content);
  console.log(`wrote make/${name}`);
}

/**
 * Compile apps/mcp/playbooks/*.md into src/playbooks.generated.ts (E9-02).
 * Lints every playbook against the server's tool names and exits non-zero on any error.
 * Usage: pnpm -F mcp build:playbooks
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { compilePlaybooks, renderGenerated } from "../src/playbooks";
import { TOOL_NAMES } from "../src/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "playbooks");
const out = join(root, "src", "playbooks.generated.ts");

const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);
const { playbooks, errors } = compilePlaybooks(files, TOOL_NAMES);
if (errors.length) {
  for (const e of errors) console.error(`playbooks: ${e}`);
  process.exit(1);
}
const source = await format(renderGenerated(playbooks), {
  ...(await resolveConfig(out)),
  filepath: out,
});
writeFileSync(out, source);
console.log(`playbooks: wrote ${Object.keys(playbooks).length} playbooks to src/playbooks.generated.ts`);

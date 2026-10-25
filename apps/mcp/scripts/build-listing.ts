/**
 * Write apps/mcp/listing/server.json (official MCP Registry) from src/listing.ts and print the Cursor deeplink (E12-02).
 * Usage: pnpm -F mcp build:listing   (SHORTLOOP_PUBLIC_URL=https://<production> to list a different origin)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { checkOfficialRegistry, cursorDeeplink, registryServerJson, shortLoopListing } from "../src/listing";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "listing", "server.json");
const listing = shortLoopListing(process.env.SHORTLOOP_PUBLIC_URL || undefined);
const server = registryServerJson(listing);
const { errors } = checkOfficialRegistry(server);
if (errors.length) {
  for (const e of errors) console.error(`server.json: ${e}`);
  process.exit(1);
}
writeFileSync(out, await format(JSON.stringify(server), { ...(await resolveConfig(out)), filepath: out }));
console.log(`wrote ${out}`);
console.log(`Cursor install link: ${cursorDeeplink(listing)}`);

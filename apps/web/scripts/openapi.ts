/** Write docs/api/openapi.yaml from the operation table (E12-01). `pnpm -F web openapi`; CI checks it's current. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOpenApiYaml } from "../src/server/api/openapi-yaml";

const out = resolve(import.meta.dirname, "../../../docs/api/openapi.yaml");
writeFileSync(out, renderOpenApiYaml());
console.log(`wrote ${out}`);

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { parse } from "yaml";
import { renderPy, renderTs, type OpenApiDoc } from "./codegen";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..", "..");
export const SPEC_PATH = join(REPO_ROOT, "docs", "api", "openapi.yaml");
export const TS_OUT = join(REPO_ROOT, "packages", "sdk-ts", "src", "generated.ts");
export const PY_OUT = join(REPO_ROOT, "packages", "sdk-py", "shortloop", "_generated.py");

export function loadSpec(): { doc: OpenApiDoc; sha256: string } {
  const raw = readFileSync(SPEC_PATH, "utf8");
  return { doc: parse(raw) as OpenApiDoc, sha256: createHash("sha256").update(raw).digest("hex") };
}

/** The two generated files, exactly as they should be committed. */
export async function generateAll(): Promise<{ path: string; contents: string }[]> {
  const { doc, sha256 } = loadSpec();
  const ts = await format(renderTs(doc, sha256), { ...(await resolveConfig(TS_OUT)), filepath: TS_OUT });
  return [
    { path: TS_OUT, contents: ts },
    { path: PY_OUT, contents: renderPy(doc, sha256) },
  ];
}

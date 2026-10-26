import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { makeApp } from "./app";

/**
 * The files under apps/integrations/make, one per block in Make's app editor, formatted like the rest of the repo.
 * `make.test.ts` fails when the committed files are stale.
 */
export async function makeFiles(dir: string): Promise<Record<string, string>> {
  const { modules, webhooks, rpcs, connection, base, ...app } = makeApp;
  const raw: Record<string, unknown> = {
    "app.json": app,
    "base.json": base,
    "connection.json": connection,
    ...Object.fromEntries(webhooks.map((w) => [`webhooks/${w.name}.json`, w])),
    ...Object.fromEntries(rpcs.map((r) => [`rpcs/${r.name}.json`, r])),
    ...Object.fromEntries(modules.map((m) => [`modules/${m.name}.json`, m])),
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const filepath = join(dir, name);
    out[name] = await format(JSON.stringify(value), { ...(await resolveConfig(filepath)), filepath });
  }
  return out;
}

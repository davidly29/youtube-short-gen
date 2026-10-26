import type { ChecklistResult } from "../checklist";
import { titleCase } from "../checklist";
import { isSupported, referencedPaths, templates } from "./iml";
import type { MakeApp, MakeModule, MakeParameter } from "./app";

/**
 * Make's review for a public custom app, as far as it can be checked offline:
 *
 * 1. The app has a lower-case name, a label, a description and a semver version.
 * 2. Base: the URL comes from the connection, errors are mapped to a readable message, and the auth header is
 *    sanitized from logs.
 * 3. Connection: validated with a real API call that also labels the connection; the key is a password field and
 *    is sanitized from logs.
 * 4. Module names follow Make's conventions: triggers "Watch …", actions "Create …" / "Get …" (Title Case), and
 *    descriptions start "Triggers when…" / "Creates…" / "Returns…" and end with a full stop.
 * 5. Every module has an output interface and samples covering it.
 * 6. Polling triggers have a Limit parameter wired into the response, and a trigger id for dedupe.
 * 7. Instant triggers use a dedicated webhook that is attached and detached through the API.
 * 8. Every parameter has help text, and every `rpc://` options source exists (and every RPC is used).
 * 9. Templates only read variables that exist in their context (parameters, connection, webhook, body, item).
 */
export const MAKE_CHECKLIST = [
  "app",
  "base",
  "connection",
  "naming",
  "interface",
  "polling",
  "webhooks",
  "parameters",
  "templates",
] as const;

const BUILTINS = new Set(["body", "item", "statusCode", "headers", "temp", "data"]);

function checkTemplates(
  where: string,
  value: unknown,
  allowed: Record<string, Set<string> | "any">,
  errors: string[],
) {
  for (const t of templates(value)) {
    for (const m of t.matchAll(/\{\{([^}]*)\}\}/g)) {
      const expr = m[1] ?? "";
      if (!isSupported(expr)) errors.push(`templates: ${where} uses unsupported {{${expr.trim()}}}`);
    }
    for (const path of referencedPaths(t)) {
      const [root, key] = path.split(".");
      if (!root) continue;
      if (BUILTINS.has(root)) continue;
      const scope = allowed[root];
      if (!scope) errors.push(`templates: ${where} reads ${path}, but ${root} isn't available there`);
      else if (scope !== "any" && key && !scope.has(key))
        errors.push(`templates: ${where} reads ${path}, which isn't defined`);
    }
  }
}

const names = (ps: MakeParameter[]) => new Set(ps.map((p) => p.name));

export function checkMake(app: MakeApp): ChecklistResult {
  const errors: string[] = [];

  if (!/^[a-z][a-z0-9-]*$/.test(app.name)) errors.push(`app: name ${app.name} must be lower case`);
  if (!app.label || !app.description) errors.push("app: needs a label and a description");
  if (!/^\d+\.\d+\.\d+$/.test(app.version)) errors.push(`app: version ${app.version} isn't semver`);

  const connParams = names(app.connection.parameters);
  const base = app.base as {
    baseUrl?: string;
    response?: { error?: { message?: string } };
    log?: { sanitize?: string[] };
  };
  if (!base.baseUrl?.includes("{{connection.")) errors.push("base: baseUrl should come from the connection");
  if (!base.response?.error?.message) errors.push("base: no error message mapping");
  if (!base.log?.sanitize?.includes("request.headers.authorization"))
    errors.push("base: authorization header isn't sanitized from logs");
  checkTemplates("base", app.base, { connection: connParams }, errors);

  const conn = app.connection.communication as {
    url?: string;
    response?: { metadata?: unknown; error?: unknown };
    log?: { sanitize?: string[] };
  };
  if (!conn.url) errors.push("connection: no validation call");
  if (!conn.response?.metadata) errors.push("connection: no metadata to label the connection");
  if (!conn.response?.error) errors.push("connection: no error mapping on the validation call");
  if (!conn.log?.sanitize?.includes("request.headers.authorization"))
    errors.push("connection: authorization header isn't sanitized from logs");
  if (app.connection.parameters.find((p) => /key|secret|token/i.test(p.name))?.type !== "password")
    errors.push("connection: the API key must be a password field");
  for (const p of app.connection.parameters)
    if (!p.help) errors.push(`parameters: connection.${p.name} has no help`);
  checkTemplates("connection", app.connection.communication, { parameters: connParams }, errors);

  const rpcNames = new Set(app.rpcs.map((r) => r.name));
  const usedRpcs = new Set<string>();
  for (const r of app.rpcs)
    checkTemplates(`rpc ${r.name}`, r.communication, { connection: connParams, parameters: "any" }, errors);

  const webhookNames = new Set(app.webhooks.map((w) => w.name));
  for (const w of app.webhooks) {
    if (w.type !== "dedicated") errors.push(`webhooks: ${w.name} should be dedicated`);
    if (!w.attach.url || !w.detach.url) errors.push(`webhooks: ${w.name} needs attach and detach calls`);
    if (!JSON.stringify(w.attach).includes("externalHookId"))
      errors.push(`webhooks: ${w.name} attach doesn't store externalHookId`);
    if (!JSON.stringify(w.detach).includes("{{webhook.externalHookId}}"))
      errors.push(`webhooks: ${w.name} detach doesn't use webhook.externalHookId`);
    const scope = { connection: connParams, webhook: new Set(["url", "externalHookId"]) };
    checkTemplates(`webhook ${w.name}`, [w.attach, w.detach], scope, errors);
    checkTemplates(`webhook ${w.name}`, w.communication, {}, errors);
  }

  for (const m of app.modules) checkModule(m, { connParams, rpcNames, usedRpcs, webhookNames }, errors);
  for (const r of rpcNames)
    if (!usedRpcs.has(r)) errors.push(`parameters: rpc ${r} isn't used by any parameter`);

  return {
    directory: "Make (public app review)",
    errors,
    ownerInputs: [
      "Make account that owns the app (create the app in Make → Custom apps, then paste the blocks from apps/integrations/make)",
      "production API URL for the connection help text and the reviewers' test connection",
      "app logo (512×512 PNG with a transparent background), app colour, documentation and privacy policy links",
      "a test account for Make's reviewers (an access code from SHORTLOOP_ACCESS_CODES works)",
    ],
  };
}

function checkModule(
  m: MakeModule,
  ctx: { connParams: Set<string>; rpcNames: Set<string>; usedRpcs: Set<string>; webhookNames: Set<string> },
  errors: string[],
) {
  const where = `module ${m.name}`;
  if (titleCase(m.label) !== m.label) errors.push(`naming: ${where} label isn't Title Case`);
  const trigger = m.type !== "action";
  if (trigger && !m.label.startsWith("Watch "))
    errors.push(`naming: ${where} trigger label should start "Watch"`);
  if (!trigger && !/^(Create|Get|Update|Delete|List|Search) /.test(m.label))
    errors.push(`naming: ${where} action label should start with a verb like Create or Get`);
  const lead = trigger
    ? ["Triggers when "]
    : ["Creates ", "Returns ", "Updates ", "Deletes ", "Lists ", "Searches "];
  if (!lead.some((l) => m.description.startsWith(l)))
    errors.push(
      `naming: ${where} description should start with ${lead.map((l) => `"${l.trim()}"`).join(" or ")}`,
    );
  if (!m.description.endsWith(".")) errors.push(`naming: ${where} description should end with "."`);

  if (!m.interface.length) errors.push(`interface: ${where} has no output interface`);
  for (const f of m.interface)
    if (!(f.name in m.samples)) errors.push(`interface: ${where} sample lacks ${f.name}`);

  const params = [...m.parameters, ...m.expect];
  for (const p of params) {
    if (!p.help) errors.push(`parameters: ${where}.${p.name} has no help`);
    if (typeof p.options === "string") {
      const rpc = p.options.replace(/^rpc:\/\//, "");
      if (!ctx.rpcNames.has(rpc)) errors.push(`parameters: ${where}.${p.name} uses missing ${p.options}`);
      ctx.usedRpcs.add(rpc);
    }
  }

  if (m.type === "trigger") {
    const res = (
      m.communication as { response?: { limit?: string; trigger?: { id?: string; type?: string } } }
    ).response;
    if (!m.parameters.some((p) => p.name === "limit"))
      errors.push(`polling: ${where} has no Limit parameter`);
    if (res?.limit !== "{{parameters.limit}}")
      errors.push(`polling: ${where} response doesn't apply the limit`);
    if (!res?.trigger?.id || !res.trigger.type) errors.push(`polling: ${where} has no trigger id for dedupe`);
  }
  if (m.type === "instant_trigger") {
    if (!m.webhook || !ctx.webhookNames.has(m.webhook))
      errors.push(`webhooks: ${where} has no dedicated webhook`);
  } else if (!m.connection) errors.push(`connection: ${where} has no connection`);

  checkTemplates(where, m.communication, { parameters: names(params), connection: ctx.connParams }, errors);
}

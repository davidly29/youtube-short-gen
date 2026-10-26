import { createRequire } from "node:module";
import type { ChecklistResult } from "../checklist";
import { titleCase } from "../checklist";

/**
 * Zapier's review for a public integration, as far as it can be checked offline:
 *
 * 1. The app definition validates against `zapier-platform-schema` (the same schema `zapier validate` uses).
 * 2. Authentication has a test call, a connection label, and help text on every field saying where to get it.
 * 3. Every visible trigger and action has a noun, a Title Case label, and a description that starts with
 *    "Triggers when…" / "Creates…" and ends with a full stop.
 * 4. Every trigger and action has a static sample and output fields; every output field key is in the sample.
 * 5. Trigger samples have an `id` (Zapier dedupes polling triggers on it).
 * 6. REST hook triggers have performSubscribe, performUnsubscribe and a performList fallback for testing.
 * 7. Dynamic dropdowns point at an existing hidden trigger, and every hidden trigger is used by one.
 * 8. Every input field has a label and help text; required fields come first.
 * 9. The app version is semver and `platformVersion` matches the schema version we validate against.
 *
 * The rest of Zapier's review needs things only the owner has; they are listed in `ownerInputs`.
 */
export const ZAPIER_CHECKLIST = [
  "schema",
  "auth",
  "display",
  "samples",
  "trigger ids",
  "rest hooks",
  "dynamic dropdowns",
  "input fields",
  "versions",
] as const;

interface Field {
  key: string;
  label?: string;
  helpText?: string;
  required?: boolean;
  dynamic?: string;
}
interface Operation {
  type?: string;
  inputFields?: Field[];
  outputFields?: { key: string }[];
  sample?: Record<string, unknown>;
  perform?: unknown;
  performList?: unknown;
  performSubscribe?: unknown;
  performUnsubscribe?: unknown;
}
interface Item {
  key: string;
  noun?: string;
  display: { label: string; description: string; hidden?: boolean };
  operation: Operation;
}
export interface ZapierAppLike {
  version: string;
  platformVersion: string;
  authentication?: {
    type: string;
    fields?: Field[];
    test?: unknown;
    connectionLabel?: string;
  };
  triggers?: Record<string, Item>;
  creates?: Record<string, Item>;
}

const require = createRequire(import.meta.url);

export function schemaVersion(): string {
  return (require("zapier-platform-schema/package.json") as { version: string }).version;
}

/**
 * Replace functions with the `$func$<arity>$f$` pointers zapier-platform-core writes before it validates or uploads
 * a definition (the schema only knows those pointers).
 */
export function serializeFunctions(value: unknown): unknown {
  if (typeof value === "function") return `$func$${value.length}$f$`;
  if (Array.isArray(value)) return value.map(serializeFunctions);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, serializeFunctions(v)]),
    );
  return value;
}

export function checkZapier(app: ZapierAppLike): ChecklistResult {
  const errors: string[] = [];
  const { validateAppDefinition } = require("zapier-platform-schema") as {
    validateAppDefinition: (def: unknown) => { errors: { stack: string }[] };
  };
  for (const e of validateAppDefinition(serializeFunctions(app)).errors) errors.push(`schema: ${e.stack}`);

  const auth = app.authentication;
  if (!auth) errors.push("auth: no authentication");
  else {
    if (!auth.test) errors.push("auth: no test call");
    if (!auth.connectionLabel) errors.push("auth: no connectionLabel");
    for (const f of auth.fields ?? []) if (!f.helpText) errors.push(`auth: field ${f.key} has no helpText`);
  }

  const triggers = Object.values(app.triggers ?? {});
  const creates = Object.values(app.creates ?? {});
  const hiddenKeys = new Set(triggers.filter((t) => t.display.hidden).map((t) => t.key));
  const usedDynamic = new Set<string>();

  const items: [Item, "trigger" | "create"][] = [
    ...triggers.map((t) => [t, "trigger"] as [Item, "trigger"]),
    ...creates.map((c) => [c, "create"] as [Item, "create"]),
  ];
  for (const [item, kind] of items) {
    const where = `${kind} ${item.key}`;
    const { display, operation: op } = item;
    if (!item.noun) errors.push(`display: ${where} has no noun`);
    if (!display.hidden) {
      if (titleCase(display.label) !== display.label) errors.push(`display: ${where} label isn't Title Case`);
      const lead = kind === "trigger" ? "Triggers when " : "Creates ";
      if (!display.description.startsWith(lead))
        errors.push(`display: ${where} description should start with "${lead.trim()}"`);
      if (!display.description.endsWith("."))
        errors.push(`display: ${where} description should end with "."`);
      if (!op.outputFields?.length) errors.push(`samples: ${where} has no outputFields`);
    }
    if (!op.sample) errors.push(`samples: ${where} has no sample`);
    for (const f of op.outputFields ?? [])
      if (op.sample && !(f.key in op.sample)) errors.push(`samples: ${where} sample lacks ${f.key}`);
    if (kind === "trigger" && op.sample && !("id" in op.sample))
      errors.push(`trigger ids: ${where} sample has no id`);
    if (op.type === "hook") {
      for (const fn of ["performSubscribe", "performUnsubscribe", "performList"] as const)
        if (!op[fn]) errors.push(`rest hooks: ${where} has no ${fn}`);
    }
    let seenOptional = false;
    for (const f of op.inputFields ?? []) {
      if (!f.label) errors.push(`input fields: ${where}.${f.key} has no label`);
      if (!f.helpText) errors.push(`input fields: ${where}.${f.key} has no helpText`);
      if (!f.required) seenOptional = true;
      else if (seenOptional)
        errors.push(`input fields: ${where}.${f.key} is required but comes after optional fields`);
      if (f.dynamic) {
        const [ref] = f.dynamic.split(".");
        if (!ref || !hiddenKeys.has(ref))
          errors.push(`dynamic dropdowns: ${where}.${f.key} points at ${f.dynamic}, not a hidden trigger`);
        else usedDynamic.add(ref);
      }
    }
  }
  for (const k of hiddenKeys)
    if (!usedDynamic.has(k)) errors.push(`dynamic dropdowns: hidden trigger ${k} is unused`);

  if (!/^\d+\.\d+\.\d+$/.test(app.version)) errors.push(`versions: app version ${app.version} isn't semver`);
  if (app.platformVersion !== schemaVersion())
    errors.push(
      `versions: platformVersion ${app.platformVersion} != zapier-platform-schema ${schemaVersion()}`,
    );

  return {
    directory: "Zapier (public integration review)",
    errors,
    ownerInputs: [
      "Zapier developer account that owns the integration (run `zapier login`, then `zapier register` once)",
      "production app URL for the help text and the reviewers' test connection",
      "logo (256×256 PNG), homepage and privacy policy URLs, a support email",
      "a test account for Zapier's reviewers (an access code from SHORTLOOP_ACCESS_CODES works)",
    ],
  };
}

/**
 * A tiny evaluator for the subset of Make's IML templates the ShortLoop app uses, so tests can "run" a module's
 * request against a fake API. Supported, and nothing else (the checklist fails anything outside it):
 *
 * - `{{a.b.c}}` alone → the value itself (objects stay objects); inside other text → its string form
 * - `{{omit(a.b; 'k1'; 'k2')}}` → a copy of the object without those keys
 * - `{{!a.b}}` → boolean negation
 */

const EXPR = /\{\{([^}]*)\}\}/g;
const PATH = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/;
const OMIT = /^omit\(\s*([A-Za-z_][\w.]*)\s*((?:;\s*'[^']*'\s*)*)\)$/;

export type Scope = Record<string, unknown>;

function lookup(scope: Scope, path: string): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Whether `expr` (the text between `{{` and `}}`) is in the supported subset. */
export function isSupported(expr: string): boolean {
  const e = expr.trim();
  return PATH.test(e) || OMIT.test(e) || (e.startsWith("!") && PATH.test(e.slice(1).trim()));
}

/** Every `a.b` path a template reads, e.g. `parameters.topic`. */
export function referencedPaths(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(EXPR)) {
    const e = (m[1] ?? "").trim();
    const omit = OMIT.exec(e);
    if (omit?.[1]) out.push(omit[1]);
    else out.push(e.replace(/^!\s*/, ""));
  }
  return out;
}

function evalExpr(expr: string, scope: Scope): unknown {
  const e = expr.trim();
  if (!isSupported(e)) throw new Error(`Unsupported IML expression: {{${e}}}`);
  if (e.startsWith("!")) return !lookup(scope, e.slice(1).trim());
  const omit = OMIT.exec(e);
  if (omit?.[1]) {
    const keys = [...(omit[2] ?? "").matchAll(/'([^']*)'/g)].map((k) => k[1]);
    const obj = lookup(scope, omit[1]);
    if (obj === null || typeof obj !== "object") return obj;
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
  }
  return lookup(scope, e);
}

/** Evaluate every template string inside `value` (recursing through arrays and objects). */
export function render(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") {
    const whole = /^\{\{([^}]*)\}\}$/.exec(value);
    if (whole) return evalExpr(whole[1] ?? "", scope);
    return value.replace(EXPR, (_m, e: string) => {
      const v = evalExpr(e, scope);
      return v === undefined || v === null ? "" : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => render(v, scope));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, scope)]));
  return value;
}

/** Every template string inside a JSON value, for the checklist. */
export function templates(value: unknown): string[] {
  if (typeof value === "string") return /\{\{[^}]*\}\}/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(templates);
  if (value && typeof value === "object") return Object.values(value).flatMap(templates);
  return [];
}

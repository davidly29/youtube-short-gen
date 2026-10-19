import { PLAYBOOKS } from "./playbooks.generated";
import { ToolUserError } from "./services";

/**
 * Format playbooks (E9-02): step-by-step instructions an agent follows to make one kind of Short.
 * The source of truth is `apps/mcp/playbooks/*.md`; `pnpm -F mcp build:playbooks` compiles them into
 * `playbooks.generated.ts` so the server never reads files at runtime (it runs inside a Next.js route).
 */

export const PHASES = ["start", "script", "visuals", "publish"] as const;
export type Phase = (typeof PHASES)[number];

export interface Playbook {
  slug: string;
  title: string;
  summary: string;
  phases: Record<Phase, string>;
}

const FRONT_MATTER_KEYS = ["slug", "title", "summary"] as const;

interface ParsedMarkdown {
  meta: Record<string, string>;
  /** `## heading` → body, in file order. */
  sections: [string, string][];
  errors: string[];
}

function parseMarkdown(markdown: string): ParsedMarkdown {
  const errors: string[] = [];
  const meta: Record<string, string> = {};
  const text = markdown.replace(/\r\n/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  let body = text;
  if (!fm) {
    errors.push("missing front matter (--- slug / title / summary ---)");
  } else {
    body = text.slice(fm[0].length);
    for (const line of (fm[1] ?? "").split("\n")) {
      if (!line.trim()) continue;
      const m = /^([a-z]+):\s*(.*)$/.exec(line);
      if (!m) {
        errors.push(`bad front matter line: ${line}`);
        continue;
      }
      meta[m[1] as string] = (m[2] ?? "").trim();
    }
  }
  const sections: [string, string][] = [];
  let current: [string, string[]] | undefined;
  for (const line of body.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      if (current) sections.push([current[0], current[1].join("\n").trim()]);
      current = [h[1] as string, []];
    } else if (current) {
      current[1].push(line);
    } else if (line.trim() && !line.startsWith("# ")) {
      errors.push(`text before the first phase heading: ${line.trim().slice(0, 60)}`);
    }
  }
  if (current) sections.push([current[0], current[1].join("\n").trim()]);
  return { meta, sections, errors };
}

/** Backticked snake_case words are tool references, e.g. `create_short`. */
const TOOL_REF = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

/** Problems with a playbook file; empty when it is valid against the given tool names. */
export function lintPlaybook(markdown: string, toolNames: readonly string[]): string[] {
  const { meta, sections, errors } = parseMarkdown(markdown);
  for (const key of FRONT_MATTER_KEYS) {
    if (!meta[key]) errors.push(`front matter is missing "${key}"`);
  }
  if (meta.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) {
    errors.push(`slug "${meta.slug}" must be kebab-case`);
  }
  const headings = sections.map(([h]) => h);
  for (const phase of PHASES) {
    const n = headings.filter((h) => h === phase).length;
    if (n === 0) errors.push(`missing phase "## ${phase}"`);
    if (n > 1) errors.push(`phase "## ${phase}" appears ${n} times`);
  }
  for (const h of headings) {
    if (!(PHASES as readonly string[]).includes(h)) errors.push(`unknown phase "## ${h}"`);
  }
  for (const [h, text] of sections) {
    if ((PHASES as readonly string[]).includes(h) && !text) errors.push(`phase "## ${h}" is empty`);
  }
  const known = new Set(toolNames);
  for (const m of markdown.matchAll(TOOL_REF)) {
    const name = m[1] as string;
    if (!known.has(name)) errors.push(`references unknown tool \`${name}\``);
  }
  return [...new Set(errors)];
}

/** Parse a playbook that already lints clean. Throws with the lint errors otherwise. */
export function parsePlaybook(markdown: string, toolNames: readonly string[]): Playbook {
  const errors = lintPlaybook(markdown, toolNames);
  if (errors.length) throw new Error(errors.join("; "));
  const { meta, sections } = parseMarkdown(markdown);
  const phases = Object.fromEntries(PHASES.map((p) => [p, sections.find(([h]) => h === p)?.[1] ?? ""]));
  return {
    slug: meta.slug as string,
    title: meta.title as string,
    summary: meta.summary as string,
    phases: phases as Record<Phase, string>,
  };
}

/**
 * Compile playbook files (`fileName` → markdown) into the PLAYBOOKS record. Returns lint errors per file
 * instead of throwing, so the build script can print them all.
 */
export function compilePlaybooks(
  files: Record<string, string>,
  toolNames: readonly string[],
): { playbooks: Record<string, Playbook>; errors: string[] } {
  const playbooks: Record<string, Playbook> = {};
  const errors: string[] = [];
  for (const name of Object.keys(files).sort()) {
    const md = files[name] as string;
    const lint = lintPlaybook(md, toolNames);
    if (lint.length) {
      errors.push(...lint.map((e) => `${name}: ${e}`));
      continue;
    }
    const pb = parsePlaybook(md, toolNames);
    if (`${pb.slug}.md` !== name) errors.push(`${name}: slug "${pb.slug}" must match the file name`);
    else playbooks[pb.slug] = pb;
  }
  return { playbooks, errors };
}

/** Source of `playbooks.generated.ts` (before prettier). */
export function renderGenerated(playbooks: Record<string, Playbook>): string {
  return `// GENERATED by \`pnpm -F mcp build:playbooks\` from apps/mcp/playbooks/*.md. Do not edit by hand.
import type { Playbook } from "./playbooks";

export const PLAYBOOKS: Record<string, Playbook> = ${JSON.stringify(playbooks, null, 2)};
`;
}

export function listWorkflows(): { slug: string; title: string; summary: string }[] {
  return Object.values(PLAYBOOKS).map(({ slug, title, summary }) => ({ slug, title, summary }));
}

export function getWorkflow(slug: string, phase: string): string {
  const pb = PLAYBOOKS[slug];
  if (!pb) {
    throw new ToolUserError(
      `No workflow "${slug}". Call list_workflows to see the formats: ${Object.keys(PLAYBOOKS).join(", ")}.`,
    );
  }
  if (!(PHASES as readonly string[]).includes(phase)) {
    throw new ToolUserError(`Unknown phase "${phase}". Phases run in order: ${PHASES.join(", ")}.`);
  }
  return pb.phases[phase as Phase];
}

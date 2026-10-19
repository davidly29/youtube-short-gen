import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "./playbooks.generated";
import { compilePlaybooks, getWorkflow, lintPlaybook, listWorkflows, PHASES } from "./playbooks";
import { createShortLoopMcpHandler, TOOL_NAMES } from "./server";
import type { ShortLoopServices } from "./services";
import { connectInProcess, data } from "./testing";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "playbooks");
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);

const VALID = `---
slug: demo
title: Demo
summary: A demo format.
---

## start

Call \`get_trends\`.

## script

Write it, then \`create_short\`.

## visuals

\`wait_for_job\` then \`swap_visual\`.

## publish

\`approve_short\` then \`publish_short\`.
`;

describe("format playbooks (E9-02)", () => {
  it("ships the four formats, each with exactly the phases start, script, visuals, publish", () => {
    expect(Object.keys(files).sort()).toEqual([
      "myth-vs-fact.md",
      "news-in-60s.md",
      "top-3-list.md",
      "trend-explainer.md",
    ]);
    for (const [name, md] of Object.entries(files)) {
      const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(headings, name).toEqual([...PHASES]);
    }
  });

  it("all shipped playbooks lint clean against the real tool names", () => {
    for (const [name, md] of Object.entries(files)) {
      expect(lintPlaybook(md, TOOL_NAMES), name).toEqual([]);
    }
    expect(lintPlaybook(VALID, TOOL_NAMES)).toEqual([]);
  });

  it("lint fails a playbook that references a tool that doesn't exist", () => {
    const bad = VALID.replace("`create_short`", "`make_video`");
    expect(lintPlaybook(bad, TOOL_NAMES)).toEqual(["references unknown tool `make_video`"]);
  });

  it("lint fails a playbook missing a phase, with an extra phase, or without front matter", () => {
    const noVisuals = VALID.replace(/## visuals[\s\S]*?(?=## publish)/, "");
    expect(lintPlaybook(noVisuals, TOOL_NAMES)).toEqual(['missing phase "## visuals"']);
    expect(lintPlaybook(`${VALID}\n## outro\n\nBye.\n`, TOOL_NAMES)).toEqual(['unknown phase "## outro"']);
    expect(lintPlaybook(VALID.replace(/^---[\s\S]*?---\n/, ""), TOOL_NAMES)).toEqual(
      expect.arrayContaining(['front matter is missing "slug"']),
    );
  });

  it("playbooks.generated.ts matches the .md files (run pnpm -F mcp build:playbooks if this fails)", () => {
    const { playbooks, errors } = compilePlaybooks(files, TOOL_NAMES);
    expect(errors).toEqual([]);
    expect(PLAYBOOKS).toEqual(playbooks);
  });

  it("news-in-60s requires citing at least 2 sources when publishing", () => {
    const publish = getWorkflow("news-in-60s", "publish");
    expect(publish).toMatch(/at least 2 sources/);
    expect(publish).toContain("`publish_short`");
  });

  it("every start phase falls back to asking the user when trends are unavailable", () => {
    for (const { slug } of listWorkflows()) {
      expect(getWorkflow(slug, "start"), slug).toMatch(/trends are unavailable[^.]*ask the user/i);
    }
  });
});

describe("list_workflows / get_workflow tools", () => {
  const services = {} as ShortLoopServices; // these tools need no services
  const auth = { token: "t", clientId: "agent", scopes: [], extra: { userId: "usr_1" } };

  it("list_workflows returns the 4 formats and get_workflow returns a phase's markdown", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services),
      auth,
    );
    const { workflows } = data<{ workflows: { slug: string; title: string }[] }>(
      await client.callTool({ name: "list_workflows", arguments: {} }),
    );
    expect(workflows.map((w) => w.slug).sort()).toEqual([
      "myth-vs-fact",
      "news-in-60s",
      "top-3-list",
      "trend-explainer",
    ]);
    const wf = data<{ slug: string; phase: string; markdown: string }>(
      await client.callTool({ name: "get_workflow", arguments: { slug: "news-in-60s", phase: "publish" } }),
    );
    expect(wf).toMatchObject({ slug: "news-in-60s", phase: "publish" });
    expect(wf.markdown).toMatch(/at least 2 sources/);
  });

  it("an unknown slug or phase is a tool error the agent can relay, not a crash", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services),
      auth,
    );
    const res = (await client.callTool({
      name: "get_workflow",
      arguments: { slug: "dance-challenge", phase: "start" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('No workflow "dance-challenge"');
    const badPhase = (await client.callTool({
      name: "get_workflow",
      arguments: { slug: "top-3-list", phase: "outro" },
    })) as { isError?: boolean };
    expect(badPhase.isError).toBe(true);
    expect(() => getWorkflow("top-3-list", "outro")).toThrow(/Unknown phase/);
  });
});

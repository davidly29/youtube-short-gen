import { describe, expect, it } from "vitest";
import { connectInProcess, data } from "./testing";
import type { JobView } from "./schemas";
import { createShortLoopMcpHandler, TOOL_NAMES } from "./server";
import { ToolUserError, type ShortLoopServices } from "./services";

/** A tiny in-memory ShortLoop with the same rules as the real services (approval before publish). */
function stubServices(): ShortLoopServices & { published: string[] } {
  const projects = new Map<string, { status: string; polls: number }>();
  const published: string[] = [];
  const view = (id: string): JobView => {
    if (id.startsWith("pubjob_")) {
      return {
        job_id: id,
        kind: "publish",
        status: "published",
        progress: 1,
        done: true,
        url: "https://www.youtube.com/shorts/x1",
      };
    }
    const p = projects.get(id.replace("job_", ""));
    if (!p) throw new ToolUserError("Unknown job");
    p.polls += 1;
    if (p.status === "producing" && p.polls > 2) p.status = "ready";
    const done = p.status !== "producing";
    return {
      job_id: id,
      kind: "production",
      project_id: id.replace("job_", ""),
      status: p.status,
      progress: done ? 1 : 0.5,
      done,
      video_url: done ? "https://files.test/v.mp4" : undefined,
    };
  };
  return {
    published,
    getTrends: async () => ({ available: false, message: "Trend radar arrives in Q2.", trends: [] }),
    createShort: async (input) => {
      const id = `prj_${projects.size + 1}`;
      projects.set(id, { status: "producing", polls: 0 });
      return {
        project_id: id,
        job_id: `job_${id}`,
        status: "producing",
        next: `wait_for_job (${input.topic})`,
      };
    },
    getJob: async (jobId) => view(jobId),
    listVoices: async () => [
      { id: "v1", label: "Ava", language: "en", provider: "fake", commercial_use: true },
    ],
    listCaptionStyles: async () => [{ id: "bold-pop", label: "Bold pop", description: "Big words" }],
    estimateCost: async () => ({
      shorts: 1,
      ai_video_credits: 0,
      balance: { shorts: 5, ai_video_credits: 0 },
      affordable: true,
      note: "",
    }),
    swapVisual: async (i) => view(`job_${i.project_id}`),
    approveShort: async (projectId) => {
      const p = projects.get(projectId);
      if (!p || p.status !== "ready") throw new ToolUserError("Render the Short first.");
      p.status = "approved";
      return { project_id: projectId, approved: true as const };
    },
    publishShort: async (i) => {
      if (projects.get(i.project_id)?.status !== "approved")
        throw new ToolUserError("Approve the Short before publishing.");
      published.push(i.project_id);
      return { publish_id: "pub_1", job_id: "pubjob_1", status: "queued", next: "wait_for_job" };
    },
    getCreditBalance: async () => ({ shorts: 5, ai_video_credits: 0 }),
  };
}

const auth = { token: "t", clientId: "agent", scopes: [], extra: { userId: "usr_1" } };

describe("ShortLoop MCP server (E9-01)", () => {
  it("lists all eleven tools with descriptions and JSON Schemas (what MCP Inspector shows)", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type, t.name).toBe("object");
    }
    const create = tools.find((t) => t.name === "create_short");
    expect(create?.inputSchema.required).toEqual(["topic"]);
    expect(Object.keys(create?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["topic", "length_seconds", "caption_style", "script"]),
    );
    expect(tools.find((t) => t.name === "get_job")?.annotations?.readOnlyHint).toBe(true);
  });

  it("scripted agent: create -> wait -> approve -> publish", async () => {
    const services = stubServices();
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services, { pollMs: 5 }),
      auth,
    );
    const created = data<{ job_id: string; project_id: string }>(
      await client.callTool({
        name: "create_short",
        arguments: { topic: "why octopuses have three hearts" },
      }),
    );
    const done = data<JobView>(
      await client.callTool({
        name: "wait_for_job",
        arguments: { job_id: created.job_id, timeout_seconds: 5 },
      }),
    );
    expect(done).toMatchObject({ status: "ready", done: true, video_url: expect.stringContaining("v.mp4") });
    data(await client.callTool({ name: "approve_short", arguments: { project_id: created.project_id } }));
    const pub = data<{ job_id: string }>(
      await client.callTool({ name: "publish_short", arguments: { project_id: created.project_id } }),
    );
    const live = data<JobView>(
      await client.callTool({ name: "wait_for_job", arguments: { job_id: pub.job_id } }),
    );
    expect(live).toMatchObject({
      kind: "publish",
      status: "published",
      url: expect.stringContaining("youtube.com/shorts"),
    });
  });

  it("publish_short without approve_short is refused with a message the agent can relay", async () => {
    const services = stubServices();
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services, { pollMs: 5 }),
      auth,
    );
    const created = data<{ project_id: string }>(
      await client.callTool({ name: "create_short", arguments: { topic: "volcano islands" } }),
    );
    const res = (await client.callTool({
      name: "publish_short",
      arguments: { project_id: created.project_id },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("Approve the Short before publishing.");
    expect(services.published).toEqual([]);
  });

  it("rejects bad input against the schema before reaching the services", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const res = (await client.callTool({
      name: "create_short",
      arguments: { topic: "x", length_seconds: 90 },
    })) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it("each request is bound to the caller from authInfo", async () => {
    const seen: string[] = [];
    const handler = createShortLoopMcpHandler((a) => {
      seen.push(String((a.extra as { userId: string }).userId));
      return stubServices();
    });
    const c1 = await connectInProcess(handler, auth);
    const c2 = await connectInProcess(handler, { ...auth, extra: { userId: "usr_2" } });
    await c1.callTool({ name: "get_credit_balance", arguments: {} });
    await c2.callTool({ name: "get_credit_balance", arguments: {} });
    expect(seen).toContain("usr_1");
    expect(seen).toContain("usr_2");
  });
});

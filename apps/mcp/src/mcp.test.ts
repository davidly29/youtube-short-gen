import { describe, expect, it } from "vitest";
import { connectInProcess, data } from "./testing";
import type { JobView } from "./schemas";
import { EXT_APPS_URL, PREVIEW_URI } from "./preview";
import { createShortLoopMcpHandler, TOOL_NAMES } from "./server";
import { ToolUserError, type ShortLoopServices } from "./services";

/** A tiny in-memory ShortLoop with the same rules as the real services (approval before publish). */
function stubServices(): ShortLoopServices & { published: string[] } {
  const projects = new Map<string, { status: string; polls: number }>();
  const published: string[] = [];
  const library: { asset_id: string; kind: string; title: string; preview_url: string }[] = [];
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
    getAccount: async () => ({
      plan: "Free",
      unlimited: false,
      credits: { shorts: 5, ai_video_credits: 0 },
      ai_scripts: true,
      channels: [],
      app_url: "https://app.test/projects",
      tips: ["Connect a YouTube channel under Channels to publish."],
    }),
    listShorts: async () => ({
      shorts: [...projects.entries()].map(([id, p]) => ({
        project_id: id,
        title: id,
        status: p.status,
        created_at: "2026-10-24T00:00:00.000Z",
        published_urls: published.includes(id) ? ["https://www.youtube.com/shorts/x1"] : [],
        app_url: `https://app.test/projects/${id}`,
      })),
    }),
    getShort: async (projectId) => {
      const p = projects.get(projectId);
      if (!p) throw new ToolUserError("Short not found");
      return {
        project_id: projectId,
        title: projectId,
        status: p.status,
        captions: [{ index: 0, text: "Octopusses" }],
        publishable: p.status !== "producing",
        problems: [],
        ai_label_required: false,
        publishes: [],
        notices: [],
        app_url: `https://app.test/projects/${projectId}`,
      };
    },
    updateCaptions: async (i) => {
      const p = projects.get(i.project_id);
      if (!p) throw new ToolUserError("Short not found");
      p.status = "producing";
      p.polls = 0;
      return view(`job_${i.project_id}`);
    },
    getRecommendations: async () => ({
      channel_id: "ch_1",
      preferred_formats: ["myth-vs-fact"],
      hook_types: ["question"],
      length_seconds: 45,
      post_hour_utc: 17,
      why: [{ field: "targetSeconds", reason: "default" }],
      based_on_shorts: 0,
    }),
    getPerformance: async () => ({ shorts: [], reconnect: [] }),
    createUpload: async (i) => {
      if (!i.i_own_this_media) throw new ToolUserError("Confirm you own or have rights to this media.");
      return {
        upload_key: `uploads/usr_1/${i.filename}`,
        upload_url: "https://app.test/api/uploads/put/x?sig=1",
        method: "PUT" as const,
        headers: { "content-type": "video/mp4" },
        next: "PUT the bytes, then finish_upload.",
      };
    },
    finishUpload: async (i) => {
      const item = {
        asset_id: "ast_up1",
        kind: "video",
        title: i.filename,
        preview_url: "https://app.test/f.mp4",
      };
      library.push(item);
      return item;
    },
    listLibrary: async () => ({ assets: library }),
  };
}

const auth = { token: "t", clientId: "agent", scopes: [], extra: { userId: "usr_1" } };

describe("ShortLoop MCP server (E9-01)", () => {
  it("lists every tool with descriptions and JSON Schemas (what MCP Inspector shows)", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(23);
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

  it("create_short takes an optional channel_voice_id and passes it to the services (E4-03b)", async () => {
    const seen: (string | undefined)[] = [];
    const services = stubServices();
    const create = services.createShort;
    services.createShort = async (input) => {
      seen.push(input.channel_voice_id);
      return create(input);
    };
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services),
      auth,
    );
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_short");
    const prop = (tool?.inputSchema.properties as Record<string, { type?: string; description?: string }>)
      .channel_voice_id;
    expect(prop?.type).toBe("string");
    expect(prop?.description).toMatch(/get_account.*Settings → Channel voice/);
    expect(tool?.inputSchema.required).not.toContain("channel_voice_id");
    expect(tool?.description).toMatch(/channel_voice_id.*Settings → Channel voice/);

    data(
      await client.callTool({
        name: "create_short",
        arguments: { topic: "roman roads", channel_voice_id: "ch_1" },
      }),
    );
    data(await client.callTool({ name: "create_short", arguments: { topic: "salt empire" } }));
    expect(seen).toEqual(["ch_1", undefined]);
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

describe("MCP v2: account, browsing, waiting, editing, guidance", () => {
  it("create_short can wait in the same call and returns the finished job", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices(), { pollMs: 5 }),
      auth,
    );
    const out = data<{ status: string; job?: JobView; next: string }>(
      await client.callTool({
        name: "create_short",
        arguments: { topic: "volcano islands", wait_seconds: 5 },
      }),
    );
    expect(out.job).toMatchObject({ done: true, status: "ready" });
    expect(out.status).toBe("ready");
    expect(out.next).toMatch(/video_url/);
  });

  it("get_account, list_shorts and get_short let an agent find and inspect earlier Shorts", async () => {
    const services = stubServices();
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services, { pollMs: 5 }),
      auth,
    );
    const account = data<{ plan: string; tips: string[] }>(
      await client.callTool({ name: "get_account", arguments: {} }),
    );
    expect(account.plan).toBe("Free");
    const created = data<{ project_id: string }>(
      await client.callTool({ name: "create_short", arguments: { topic: "volcano islands" } }),
    );
    const list = data<{ shorts: { project_id: string; app_url: string }[] }>(
      await client.callTool({ name: "list_shorts", arguments: {} }),
    );
    expect(list.shorts.map((s) => s.project_id)).toEqual([created.project_id]);
    const detail = data<{ captions: { index: number }[]; app_url: string }>(
      await client.callTool({ name: "get_short", arguments: { project_id: created.project_id } }),
    );
    expect(detail.app_url).toContain(created.project_id);
    const fix = data<JobView>(
      await client.callTool({
        name: "update_captions",
        arguments: { project_id: created.project_id, edits: [{ index: 0, text: "Octopuses" }] },
      }),
    );
    expect(fix.kind).toBe("production");
  });

  it("read-only tools are marked read-only; editing tools are not", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const { tools } = await client.listTools();
    const ro = (n: string) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint === true;
    for (const n of [
      "get_account",
      "list_shorts",
      "get_short",
      "get_recommendations",
      "get_performance",
      "get_guide",
    ])
      expect(ro(n), n).toBe(true);
    for (const n of ["create_short", "update_captions", "approve_short", "publish_short"])
      expect(ro(n), n).toBe(false);
  });

  it("every tool carries a safety annotation (readOnlyHint or an explicit destructiveHint)", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const { tools } = await client.listTools();
    const missing = tools
      .filter(
        (t) => t.annotations?.readOnlyHint !== true && typeof t.annotations?.destructiveHint !== "boolean",
      )
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("serves a getting-started guide and a make_a_short prompt", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices()),
      auth,
    );
    const guide = data<{ markdown: string }>(await client.callTool({ name: "get_guide", arguments: {} }));
    for (const tool of ["get_account", "create_short", "approve_short", "publish_short"])
      expect(guide.markdown).toContain(tool);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["make_a_short"]);
    const prompt = await client.getPrompt({ name: "make_a_short", arguments: { topic: "volcano islands" } });
    const first = prompt.messages[0]?.content as { type: string; text: string };
    expect(first.text).toContain("volcano islands");
    expect(first.text).toContain("ask before approving");
  });

  it("every tool the guide and instructions mention exists", async () => {
    const { GUIDE } = await import("./server");
    const mentioned = [...GUIDE.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? "");
    const tools = new Set<string>(TOOL_NAMES);
    const params = new Set([
      "script",
      "ai_scripts",
      "topic_id",
      "angle",
      "wait_seconds",
      "done",
      "video_url",
      "app_url",
      "scheduled_at",
      "channel_voice_id",
      "channel_id",
    ]);
    for (const name of mentioned) expect(tools.has(name) || params.has(name), name).toBe(true);
  });
});

describe("MCP-03: uploads and the in-chat preview", () => {
  it("upload: refuse without attestation; create -> finish -> list_library -> use in create_short", async () => {
    const services = stubServices();
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => services, { pollMs: 5 }),
      auth,
    );
    const refused = (await client.callTool({
      name: "create_upload",
      arguments: { filename: "trip.mp4", size_bytes: 1000, i_own_this_media: false },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(refused.isError).toBe(true);
    const up = data<{ upload_url: string; method: string; upload_key: string }>(
      await client.callTool({
        name: "create_upload",
        arguments: { filename: "trip.mp4", size_bytes: 1000, i_own_this_media: true },
      }),
    );
    expect(up).toMatchObject({ method: "PUT", upload_url: expect.stringMatching(/^https:/) });
    const asset = data<{ asset_id: string }>(
      await client.callTool({
        name: "finish_upload",
        arguments: { upload_key: up.upload_key, filename: "trip.mp4", i_own_this_media: true },
      }),
    );
    const lib = data<{ assets: { asset_id: string }[] }>(
      await client.callTool({ name: "list_library", arguments: {} }),
    );
    expect(lib.assets.map((a) => a.asset_id)).toEqual([asset.asset_id]);
    const made = data<{ project_id: string }>(
      await client.callTool({
        name: "create_short",
        arguments: { topic: "my trip to the coast", library_asset_ids: [asset.asset_id] },
      }),
    );
    expect(made.project_id).toBeTruthy();
  });

  it("get_short, create_short and wait_for_job render in the MCP Apps preview; the view is served with its CSP", async () => {
    const client = await connectInProcess(
      createShortLoopMcpHandler(() => stubServices(), { mediaOrigins: ["https://app.test"] }),
      auth,
    );
    const { tools } = await client.listTools();
    for (const name of ["get_short", "create_short", "wait_for_job"]) {
      const meta = tools.find((t) => t.name === name)?._meta as { ui?: { resourceUri?: string } } | undefined;
      expect(meta?.ui?.resourceUri, name).toBe(PREVIEW_URI);
    }
    const { resources } = await client.listResources();
    expect(resources.map((r) => [r.uri, r.mimeType])).toEqual([[PREVIEW_URI, "text/html;profile=mcp-app"]]);
    const read = await client.readResource({ uri: PREVIEW_URI });
    const content = read.contents[0] as {
      text: string;
      mimeType: string;
      _meta?: { ui?: { csp?: { resourceDomains?: string[] } } };
    };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain(EXT_APPS_URL);
    expect(content.text).toContain("app.connect()");
    expect(content.text).not.toContain("innerHTML");
    expect(content._meta?.ui?.csp?.resourceDomains).toEqual(["https://unpkg.com", "https://app.test"]);
  });
});

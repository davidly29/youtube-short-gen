import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { ToolUserError, type JobView, type ShortLoopServices } from "@shortloop/mcp";
import { SecretBox } from "@shortloop/providers";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import type { Runtime } from "../runtime";

vi.mock("server-only", () => ({}));

const SPEC_PATH = resolve(import.meta.dirname, "../../../../../docs/api/openapi.yaml");
type Json = Record<string, unknown>;
const spec = parse(readFileSync(SPEC_PATH, "utf8")) as {
  paths: Record<string, Record<string, { operationId: string; responses: Record<string, Json> }>>;
  components: Json;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("date-time", true);
ajv.addFormat("uri", true);
ajv.addSchema({ $id: "openapi.json", components: spec.components });

/** Which (operation, status) pairs the tests produced, to prove every documented response was checked. */
const seen = new Set<string>();

const OPS = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({
    path,
    method,
    op,
    re: new RegExp(`^${path.replace(/\./g, "\\.").replace(/\{\w+\}/g, "[^/]+")}$`),
  })),
);

/** Validate a response against the operation and status the committed OpenAPI file documents for it. */
async function check(res: Response, method: string, url: string): Promise<Json> {
  const path = new URL(url, "http://x").pathname.replace(/^\/api\/v1/, "");
  const match = OPS.find((o) => o.method === method.toLowerCase() && o.re.test(path));
  if (!match) throw new Error(`no documented operation for ${method} ${path}`);
  const doc = match.op.responses[String(res.status)] as
    { content?: Record<string, { schema: { $ref: string } }>; headers?: Record<string, unknown> } | undefined;
  if (!doc) throw new Error(`${match.op.operationId} returned undocumented status ${res.status}`);
  const body = (await res.json()) as Json;
  const ref = doc.content?.["application/json"]?.schema.$ref ?? "";
  const validate = ajv.getSchema(`openapi.json${ref}`);
  if (!validate) throw new Error(`can't resolve ${ref}`);
  if (!validate(body)) {
    throw new Error(
      `${match.op.operationId} ${res.status} doesn't match ${ref}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body)}`,
    );
  }
  for (const h of Object.keys(doc.headers ?? {})) {
    expect(res.headers.get(h), `${match.op.operationId} ${res.status} header ${h}`).toBeTruthy();
  }
  seen.add(`${match.op.operationId} ${res.status}`);
  return body;
}

let h: DbHandle;
const box = new SecretBox("api-contract-test-master-key-123");
const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  await h.db.insert(schema.users).values({ id: "usr_other", email: "other@example.test", name: "Other" });
  g.__shortloop = Promise.resolve({ db: h.db, box } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  await h.close();
});

/** Fake services: the REST layer only translates, so its contract is tested against these. */
function fakeServices(userId: string): ShortLoopServices {
  const job = (id: string, done: boolean): JobView => ({
    job_id: id,
    kind: "production",
    project_id: "prj_1",
    status: done ? "ready" : "producing",
    stage: done ? undefined : "render",
    progress: done ? 1 : 0.5,
    done,
    video_url: done ? "https://files.example.test/r.mp4?sig=1" : undefined,
    publishable: done,
  });
  let polls = 0;
  return {
    async getTrends() {
      return { available: false, message: "Q2", trends: [] };
    },
    async createShort(input) {
      if (input.topic.includes("forbidden")) throw new ToolUserError("That topic can't be made.");
      return { project_id: "prj_1", job_id: "job_1", status: "scripting", next: "Call wait_for_job." };
    },
    async getJob(jobId) {
      if (jobId === "job_missing") throw new ToolUserError("Unknown job.");
      return job(jobId, ++polls >= 3);
    },
    async listVoices() {
      return [{ id: "edge:en-US", label: "Ava", language: "en-US", provider: "edge", commercial_use: false }];
    },
    async listCaptionStyles() {
      return [{ id: "bold-pop", label: "Bold pop", description: "Big words" }];
    },
    async estimateCost(input) {
      return {
        shorts: 1,
        ai_video_credits: Math.ceil(input.ai_video_seconds / 5),
        balance: { shorts: 5, ai_video_credits: 0 },
        affordable: true,
        note: "One credit",
      };
    },
    async swapVisual(input) {
      return { ...job("job_swap", false), project_id: input.project_id };
    },
    async approveShort(projectId) {
      if (projectId === "prj_missing") throw new ToolUserError("Project not found.");
      return { project_id: projectId, approved: true as const };
    },
    async publishShort(input) {
      if (input.project_id === "prj_unapproved")
        throw new ToolUserError("Approve the Short before publishing.");
      return { publish_id: "pub_1", job_id: "job_pub", status: "queued", next: "Call wait_for_job." };
    },
    async getCreditBalance() {
      return { shorts: userId === SEED.userId ? 5 : 0, ai_video_credits: 0 };
    },
    async getAccount() {
      return {
        plan: "Free",
        unlimited: false,
        credits: { shorts: 5, ai_video_credits: 0 },
        ai_scripts: true,
        channels: [],
        app_url: "https://app.example.test/projects",
        tips: [],
      };
    },
    async listShorts(input) {
      return {
        shorts: [
          {
            project_id: "prj_1",
            title: "Octopus hearts",
            status: "ready",
            created_at: "2026-10-25T00:00:00.000Z",
            published_urls: [],
            app_url: "https://app.example.test/projects/prj_1",
          },
        ].slice(0, input.limit),
      };
    },
    async getShort(projectId) {
      if (projectId === "prj_missing") throw new ToolUserError("Project not found.");
      return {
        project_id: projectId,
        title: "Octopus hearts",
        status: "ready",
        captions: [{ index: 0, text: "Octopuses" }],
        publishable: true,
        problems: [],
        ai_label_required: false,
        publishes: [],
        notices: [],
        app_url: `https://app.example.test/projects/${projectId}`,
      };
    },
    async updateCaptions(input) {
      return { ...job("job_captions", false), project_id: input.project_id };
    },
    async getRecommendations(input) {
      return {
        channel_id: input.channel_id ?? "ch_1",
        preferred_formats: ["myth-vs-fact"],
        hook_types: ["question"],
        length_seconds: 45,
        post_hour_utc: 17,
        why: [{ field: "targetSeconds", reason: "Default until the channel has Shorts." }],
        based_on_shorts: 0,
      };
    },
    async getPerformance() {
      return { shorts: [], reconnect: [] };
    },
    async createUpload(input) {
      if (!input.i_own_this_media) throw new ToolUserError("Confirm you own this media.");
      return {
        upload_key: "uploads/usr/a.mp4",
        upload_url: "https://app.example.test/api/uploads/put/uploads/usr/a.mp4?sig=1",
        method: "PUT" as const,
        headers: { "content-type": "video/mp4" },
        next: "PUT, then finish.",
      };
    },
    async finishUpload(input) {
      return {
        asset_id: "ast_1",
        kind: "video",
        title: input.filename,
        preview_url: "https://app.example.test/f.mp4",
      };
    },
    async listLibrary() {
      return { assets: [] };
    },
  };
}

async function newKey(userId = SEED.userId) {
  const { createApiKey } = await import("./keys");
  return (await createApiKey(userId, { name: "Contract tests" })).key;
}

async function api(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; raw?: string; rateLimit?: number } = {},
) {
  const { handleApiRequest } = await import("./router");
  const url = `http://localhost/api/v1${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  const res = await handleApiRequest(
    new Request(url, {
      method,
      headers,
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    }),
    { servicesFor: fakeServices, rateLimit: opts.rateLimit ?? 1000, pollMs: 5 },
  );
  return { res, body: await check(res.clone(), method, url), status: res.status };
}

describe("public REST API contract (E12-01)", () => {
  it("docs/api/openapi.yaml is generated from the operation table and is current", async () => {
    const { renderOpenApiYaml } = await import("./openapi-yaml");
    expect(readFileSync(SPEC_PATH, "utf8"), "run `pnpm -F web openapi` and commit the result").toBe(
      renderOpenApiYaml(),
    );
    const { OPERATIONS } = await import("./spec");
    expect(OPS.map((o) => o.op.operationId).sort()).toEqual(OPERATIONS.map((o) => o.id).sort());
    expect((spec as unknown as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("every endpoint mirrors an MCP tool and its responses match the spec", async () => {
    const key = await newKey();
    expect((await api("GET", "/balance", { key })).body).toEqual({ shorts: 5, ai_video_credits: 0 });
    expect((await api("GET", "/voices", { key })).body.voices).toHaveLength(1);
    expect((await api("GET", "/caption-styles", { key })).body.styles).toHaveLength(1);
    expect((await api("GET", "/trends?niche=science", { key })).body.available).toBe(false);
    expect((await api("POST", "/estimate", { key, body: { ai_video_seconds: 12 } })).body).toMatchObject({
      ai_video_credits: 3,
    });

    expect((await api("GET", "/account", { key })).body.plan).toBe("Free");
    expect((await api("GET", "/recommendations?channel_id=ch_9", { key })).body.channel_id).toBe("ch_9");
    expect((await api("GET", "/performance", { key })).body).toEqual({ shorts: [], reconnect: [] });
    expect((await api("GET", "/shorts?limit=5", { key })).body.shorts).toHaveLength(1);
    expect((await api("GET", "/shorts/prj_1", { key })).body.app_url).toContain("prj_1");
    expect((await api("GET", "/shorts/prj_missing", { key })).status).toBe(404);
    const fixed = await api("POST", "/shorts/prj_1/captions", {
      key,
      body: { edits: [{ index: 0, text: "Hi" }] },
    });
    expect(fixed.status).toBe(202);

    const up = await api("POST", "/uploads", {
      key,
      body: { filename: "a.mp4", size_bytes: 10, i_own_this_media: true },
    });
    expect(up.status).toBe(201);
    expect(
      (
        await api("POST", "/uploads", {
          key,
          body: { filename: "a.mp4", size_bytes: 10, i_own_this_media: false },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api("POST", "/uploads/finish", {
          key,
          body: { upload_key: up.body.upload_key, filename: "a.mp4", i_own_this_media: true },
        })
      ).body.asset_id,
    ).toBe("ast_1");
    expect((await api("GET", "/library", { key })).body).toEqual({ assets: [] });

    // wait_seconds holds the create call until the Short is done (like the MCP tool).
    const waitedCreate = await api("POST", "/shorts", {
      key,
      body: { topic: "volcano islands", wait_seconds: 5 },
    });
    expect(waitedCreate.body).toMatchObject({ status: "ready", job: { done: true } });

    const created = await api("POST", "/shorts", { key, body: { topic: "why octopuses have three hearts" } });
    expect(created.status).toBe(202);
    expect(created.body.next).toBe("GET /api/v1/jobs/job_1?wait=50 until done is true.");

    const first = await api("GET", "/jobs/job_1", { key });
    expect(first.body).toMatchObject({ done: false });
    // ?wait= holds the request until the job is done (like MCP wait_for_job).
    const waited = await api("GET", "/jobs/job_1?wait=5", { key });
    expect(waited.body).toMatchObject({ done: true, status: "ready" });

    expect((await api("POST", "/shorts/prj_1/visuals", { key, body: { shot: 2 } })).status).toBe(202);
    expect((await api("POST", "/shorts/prj_1/approve", { key })).body).toEqual({
      project_id: "prj_1",
      approved: true,
    });
    const pub = await api("POST", "/shorts/prj_1/publish", { key, body: { tags: ["octopus"] } });
    expect(pub.status).toBe(202);
    expect(pub.body).toMatchObject({ publish_id: "pub_1", job_id: "job_pub" });

    const wf = await api("GET", "/workflows", { key });
    const slug = (wf.body.workflows as { slug: string }[])[0]?.slug ?? "";
    expect(slug).toBeTruthy();
    expect((await api("GET", `/workflows/${slug}/start`, { key })).body.markdown).toBeTruthy();

    const spec = await api("GET", "/openapi.json");
    expect(spec.body.openapi).toBe("3.1.0");
  });

  it("webhooks can be registered, listed, inspected and removed; secrets are shown once", async () => {
    const key = await newKey();
    const made = await api("POST", "/webhooks", { key, body: { url: "https://hooks.example.com/sl" } });
    expect(made.status).toBe(201);
    expect(made.body.secret).toMatch(/^whsec_/);
    expect(made.body.events).toEqual(["job.succeeded", "job.failed", "publish.completed"]);
    const id = String(made.body.id);

    const listed = await api("GET", "/webhooks", { key });
    expect(listed.body.webhooks).toEqual([
      { id, url: "https://hooks.example.com/sl", events: made.body.events, created_at: made.body.created_at },
    ]);
    expect(JSON.stringify(listed.body)).not.toContain("whsec_");
    const row = await h.db.query.webhooks.findFirst({ where: eq(schema.webhooks.id, id) });
    expect(row?.secret).not.toContain(String(made.body.secret)); // sealed at rest

    expect((await api("GET", `/webhooks/${id}/deliveries`, { key })).body).toEqual({ deliveries: [] });
    expect((await api("DELETE", `/webhooks/${id}`, { key })).body).toEqual({ id, deleted: true });
    expect((await api("GET", "/webhooks", { key })).body).toEqual({ webhooks: [] });
    expect((await api("GET", `/webhooks/${id}/deliveries`, { key })).status).toBe(404);

    const bad = await api("POST", "/webhooks", { key, body: { url: "http://169.254.169.254/latest" } });
    expect(bad.status).toBe(400);
    expect((bad.body.error as { message: string }).message).toContain("https");
  });

  it("errors use one envelope: 400, 401, 404 and 405", async () => {
    const key = await newKey();
    expect((await api("GET", "/balance")).status).toBe(401);
    expect((await api("GET", "/balance", { key: "sl_not-a-real-key" })).status).toBe(401);

    const invalid = await api("POST", "/shorts", { key, body: { topic: "x" } });
    expect(invalid.status).toBe(400);
    expect((invalid.body.error as { message: string }).message).toMatch(/^topic: /);
    expect((await api("POST", "/shorts", { key, raw: "{not json" })).status).toBe(400);
    expect((await api("POST", "/shorts", { key, body: { topic: "a forbidden topic" } })).status).toBe(400);
    expect((await api("GET", "/jobs/job_1?wait=999", { key })).status).toBe(400);
    expect((await api("GET", "/jobs/job_missing", { key })).status).toBe(404);
    expect((await api("POST", "/shorts/prj_missing/approve", { key })).status).toBe(404);
    const early = await api("POST", "/shorts/prj_unapproved/publish", { key });
    expect(early.status).toBe(400);
    expect((early.body.error as { message: string }).message).toContain("Approve the Short");
    expect((await api("GET", "/workflows/nope/start", { key })).status).toBe(404);
    expect((await api("GET", "/workflows/trend-explainer/bogus", { key })).status).toBe(400);
    expect((await api("DELETE", "/webhooks/wh_nope", { key })).status).toBe(404);

    const { handleApiRequest } = await import("./router");
    const unknown = await handleApiRequest(new Request("http://localhost/api/v1/nope"));
    expect(unknown.status).toBe(404);
    const wrong = await handleApiRequest(
      new Request("http://localhost/api/v1/balance", { method: "DELETE" }),
    );
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
  });

  it("rate limits each key separately and answers 429 with Retry-After", async () => {
    const a = await newKey();
    const b = await newKey();
    for (let i = 0; i < 3; i++) {
      const ok = await api("GET", "/balance", { key: a, rateLimit: 3 });
      expect(ok.status).toBe(200);
      expect(ok.res.headers.get("x-ratelimit-remaining")).toBe(String(2 - i));
    }
    const limited = await api("GET", "/balance", { key: a, rateLimit: 3 });
    expect(limited.status).toBe(429);
    const retry = Number(limited.res.headers.get("retry-after"));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect((await api("GET", "/balance", { key: b, rateLimit: 3 })).status).toBe(200);
  });

  it("concurrent requests never get more than the limit", async () => {
    const key = await newKey();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => api("GET", "/balance", { key, rateLimit: 5 })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it("keys act only as their owner, and revoked keys stop working", async () => {
    const { createApiKey, listApiKeys, revokeApiKey } = await import("./keys");
    const { key, info } = await createApiKey("usr_other", { name: "Other's key" });
    expect(key).toMatch(/^sl_[\w-]{40}$/);
    expect(info.prefix).toBe(key.slice(0, 11));
    const row = await h.db.query.publicApiKeys.findFirst({ where: eq(schema.publicApiKeys.id, info.id) });
    expect(row?.hash).not.toContain(key); // only a hash is stored
    expect((await api("GET", "/balance", { key })).body).toEqual({ shorts: 0, ai_video_credits: 0 });
    // Another user's webhook isn't visible or removable with this key.
    const mine = await newKey();
    const made = await api("POST", "/webhooks", { key: mine, body: { url: "https://hooks.example.com/a" } });
    expect((await api("GET", "/webhooks", { key })).body).toEqual({ webhooks: [] });
    expect((await api("DELETE", `/webhooks/${String(made.body.id)}`, { key })).status).toBe(404);

    await expect(revokeApiKey(SEED.userId, info.id)).rejects.toThrow("Unknown API key");
    await revokeApiKey("usr_other", info.id);
    expect(await listApiKeys("usr_other")).toEqual([]);
    expect((await api("GET", "/balance", { key })).status).toBe(401);
  });

  it("runs on the web app's own services by default", async () => {
    const key = await newKey();
    const { handleApiRequest } = await import("./router");
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/balance", { headers: { authorization: `Bearer ${key}` } }),
    );
    expect(await check(res, "GET", "/api/v1/balance")).toEqual({ shorts: 5, ai_video_credits: 0 });
  });

  it("the checker itself rejects responses that drift from the spec", async () => {
    const drifted = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    await expect(
      check(drifted({ shorts: "5", ai_video_credits: 0 }), "GET", "/api/v1/balance"),
    ).rejects.toThrow("doesn't match");
    await expect(
      check(drifted({ shorts: 5, ai_video_credits: 0, extra: true }), "GET", "/api/v1/balance"),
    ).rejects.toThrow("doesn't match");
    await expect(check(drifted({}, 418), "GET", "/api/v1/balance")).rejects.toThrow("undocumented status");
  });

  it("every documented success response, and every error status, was exercised", () => {
    const missing: string[] = [];
    for (const o of OPS) {
      const success = Object.keys(o.op.responses).find((s) => s.startsWith("2"));
      if (!seen.has(`${o.op.operationId} ${success}`)) missing.push(`${o.op.operationId} ${success}`);
    }
    expect(missing).toEqual([]);
    for (const status of ["400", "401", "404", "429"])
      expect(
        [...seen].some((s) => s.endsWith(` ${status}`)),
        status,
      ).toBe(true);
  });
});

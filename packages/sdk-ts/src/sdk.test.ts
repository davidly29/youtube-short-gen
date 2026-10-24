import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { quickstart } from "../examples/quickstart";
import { operations, snake } from "../scripts/codegen";
import { generateAll, loadSpec, PY_OUT } from "../scripts/sources";
import { JobFailedError, ShortLoop, ShortLoopError, parseWebhook, verifyWebhook, SPEC_SHA256 } from "./index";
import { createFakeApi, type Exchange } from "./test/fake-api";

const BASE = "https://shortloop.test/api/v1";
const { doc, sha256 } = loadSpec();
const ops = operations(doc);

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("date-time", true);
ajv.addSchema({ $id: "openapi.json", components: doc.components });

function validate(ref: string, value: unknown, what: string) {
  const v = ajv.getSchema(`openapi.json${ref}`);
  if (!v) throw new Error(`no schema ${ref}`);
  if (!v(value))
    throw new Error(`${what} doesn't match ${ref}: ${ajv.errorsText(v.errors)}\n${JSON.stringify(value)}`);
}

type RawOp = {
  operationId: string;
  requestBody?: { content: { "application/json": { schema: { $ref: string } } } };
  responses: Record<string, { content?: { "application/json"?: { schema: { $ref: string } } } }>;
};

/** Check one recorded exchange against the operation and status the spec documents for it. */
function checkAgainstSpec(x: Exchange) {
  const match = Object.entries(doc.paths).find(
    ([tpl, methods]) =>
      new RegExp(`^${tpl.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(x.path) && methods[x.method.toLowerCase()],
  );
  if (!match) throw new Error(`undocumented endpoint ${x.method} ${x.path}`);
  const op = match[1][x.method.toLowerCase()] as unknown as RawOp;
  const reqRef = op.requestBody?.content["application/json"].schema.$ref;
  if (reqRef && x.requestBody !== undefined && x.status < 300)
    validate(reqRef, x.requestBody, `${op.operationId} request`);
  const res = op.responses[String(x.status)];
  if (!res) throw new Error(`${op.operationId} doesn't document status ${x.status}`);
  const resRef = res.content?.["application/json"]?.schema.$ref;
  if (resRef) validate(resRef, x.body, `${op.operationId} ${x.status}`);
  return op.operationId;
}

const fastSleep = async () => {};

describe("generated SDKs (E12-02)", () => {
  it("are generated from the committed docs/api/openapi.yaml and are current", async () => {
    for (const file of await generateAll()) {
      expect(readFileSync(file.path, "utf8"), `${file.path} is stale: run pnpm -F sdk-ts generate`).toBe(
        file.contents,
      );
    }
    expect(SPEC_SHA256).toBe(sha256);
  });

  it("cover every operation in the spec, in both languages", () => {
    const sl = new ShortLoop({ apiKey: "sl_x", baseUrl: BASE }) as unknown as Record<string, unknown>;
    const py = readFileSync(PY_OUT, "utf8");
    expect(ops.length).toBeGreaterThanOrEqual(16);
    for (const op of ops) {
      const camel = op.id.charAt(0).toLowerCase() + op.id.slice(1);
      expect(typeof sl[camel], `TS method ${camel}`).toBe("function");
      expect(py, `Python method ${snake(op.id)}`).toContain(`def ${snake(op.id)}(self`);
    }
  });
});

describe("TypeScript SDK quick-start (E12-02)", () => {
  it("creates, approves and publishes a Short; every request and response matches the spec", async () => {
    const api = createFakeApi();
    const sl = new ShortLoop({ apiKey: api.key, baseUrl: BASE, fetch: api.fetch, sleep: fastSleep });
    const lines: string[] = [];
    const result = await quickstart(sl, {
      topic: "why octopuses have three hearts",
      log: (l) => lines.push(l),
    });

    expect(result).toMatchObject({
      publishStatus: "published",
      youtubeUrl: "https://www.youtube.com/shorts/fake123",
      creditsBefore: 5,
      creditsAfter: 4,
    });
    expect(result.videoUrl).toMatch(/\.mp4$/);
    const used = api.exchanges.map(checkAgainstSpec);
    expect(new Set(used)).toEqual(
      new Set(["getBalance", "createShort", "getJob", "approveShort", "publishShort"]),
    );
    // waits on the server instead of busy polling, and publishes privately by default
    expect(api.exchanges.filter((x) => x.path.startsWith("/jobs/")).every((x) => x.query.wait === "50")).toBe(
      true,
    );
    expect(api.exchanges.find((x) => x.path.endsWith("/publish"))?.requestBody).toEqual({
      privacy: "private",
    });
    expect(lines.join("\n")).toContain("publish published");
  });

  it("sends the key as a bearer token and maps the error envelope", async () => {
    const api = createFakeApi();
    const bad = new ShortLoop({ apiKey: "sl_wrong", baseUrl: BASE, fetch: api.fetch });
    await expect(bad.getBalance()).rejects.toMatchObject({
      name: "ShortLoopError",
      status: 401,
      code: "unauthorized",
      operationId: "getBalance",
    });

    const sl = new ShortLoop({ apiKey: api.key, baseUrl: `${BASE}/`, fetch: api.fetch, sleep: fastSleep });
    const { project_id, job_id } = await sl.createShort({ topic: "octopus hearts" });
    await sl.waitForJob(job_id);
    const early = await sl.publishShort(project_id).catch((e: unknown) => e);
    expect(early).toBeInstanceOf(ShortLoopError);
    expect(early).toMatchObject({ status: 400, code: "invalid_request" });
    expect((early as Error).message).toMatch(/Approve/);
    await expect(sl.createShort({ topic: "x" })).rejects.toMatchObject({ status: 400 });
    api.exchanges.forEach(checkAgainstSpec);
  });

  it("retries 429 after Retry-After, then gives up with the wait in the error", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);
    const api = createFakeApi({ rateLimitNext: 2 });
    const sl = new ShortLoop({ apiKey: api.key, baseUrl: BASE, fetch: api.fetch, sleep });
    expect((await sl.getBalance()).shorts).toBe(5);
    expect(slept).toEqual([1000, 1000]);

    const busy = createFakeApi({ rateLimitNext: 5 });
    const once = new ShortLoop({ apiKey: busy.key, baseUrl: BASE, fetch: busy.fetch, sleep, maxRetries: 1 });
    await expect(once.listVoices()).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
    [...api.exchanges, ...busy.exchanges].forEach(checkAgainstSpec);
  });

  it("waitForJob throws JobFailedError for failed jobs", async () => {
    const api = createFakeApi({ failTopic: "doomed" });
    const sl = new ShortLoop({ apiKey: api.key, baseUrl: BASE, fetch: api.fetch });
    const { job_id } = await sl.createShort({ topic: "a doomed Short" });
    const e = await sl.waitForJob(job_id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(JobFailedError);
    expect((e as JobFailedError).job.status).toBe("failed");
    expect(api.credits()).toBe(5);
    api.exchanges.forEach(checkAgainstSpec);
  });

  it("other endpoints build the right paths and queries", async () => {
    const api = createFakeApi();
    const sl = new ShortLoop({ apiKey: api.key, baseUrl: BASE, fetch: api.fetch });
    await sl.listCaptionStyles();
    await sl.estimateCost({ length_seconds: 60 });
    await sl.getTrends({ niche: "science" });
    await sl.listWorkflows();
    await sl.getWorkflow("myth-vs-fact", "start");
    expect(api.exchanges.map((x) => `${x.method} ${x.path}`)).toEqual([
      "GET /caption-styles",
      "POST /estimate",
      "GET /trends",
      "GET /workflows",
      "GET /workflows/myth-vs-fact/start",
    ]);
    expect(api.exchanges[2]?.query).toEqual({ niche: "science" });
    api.exchanges.forEach(checkAgainstSpec);
  });

  it("needs a key and a base URL", () => {
    const saved = { key: process.env.SHORTLOOP_API_KEY, url: process.env.SHORTLOOP_API_URL };
    delete process.env.SHORTLOOP_API_KEY;
    delete process.env.SHORTLOOP_API_URL;
    try {
      expect(() => new ShortLoop({ baseUrl: BASE })).toThrow(/SHORTLOOP_API_KEY/);
      expect(() => new ShortLoop({ apiKey: "sl_x" })).toThrow(/SHORTLOOP_API_URL/);
    } finally {
      if (saved.key) process.env.SHORTLOOP_API_KEY = saved.key;
      if (saved.url) process.env.SHORTLOOP_API_URL = saved.url;
    }
  });
});

describe("webhook verification (E12-02)", () => {
  // Signed exactly the way the server signs (packages/providers/src/webhooks).
  const secret = "whsec_test";
  const body = JSON.stringify({
    id: "evt_1",
    type: "job.succeeded",
    created_at: "2026-10-24T10:00:00.000Z",
    data: { job_id: "job_1", kind: "production", status: "ready" },
  });
  const sign = (t: number, b = body, s = secret) =>
    `t=${t},v1=${createHmac("sha256", s).update(`${t}.${b}`).digest("hex")}`;
  const now = 1_800_000_000;

  it("accepts the server's signatures and rejects tampering, wrong secrets and stale ones", async () => {
    expect(await verifyWebhook(body, sign(now), secret, { nowSeconds: now })).toBe(true);
    expect(await verifyWebhook(body, sign(now - 299), secret, { nowSeconds: now })).toBe(true);
    expect(await verifyWebhook(body, sign(now - 301), secret, { nowSeconds: now })).toBe(false);
    expect(await verifyWebhook(body + " ", sign(now), secret, { nowSeconds: now })).toBe(false);
    expect(await verifyWebhook(body, sign(now, body, "other"), secret, { nowSeconds: now })).toBe(false);
    expect(await verifyWebhook(body, undefined, secret)).toBe(false);
    expect(await verifyWebhook(body, "garbage", secret)).toBe(false);
    // secret rotation: any matching v1 passes
    const rotated = `${sign(now, body, "old")},v1=${sign(now).split("v1=")[1]}`;
    expect(await verifyWebhook(body, rotated, secret, { nowSeconds: now })).toBe(true);
  });

  it("parseWebhook returns a spec-valid payload or throws", async () => {
    const payload = await parseWebhook(body, sign(now), secret, { nowSeconds: now });
    validate("#/components/schemas/WebhookPayload", payload, "webhook payload");
    expect(payload.data.job_id).toBe("job_1");
    await expect(parseWebhook(body, sign(now - 1000), secret, { nowSeconds: now })).rejects.toThrow(
      /signature/,
    );
  });
});

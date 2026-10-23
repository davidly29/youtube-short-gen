import "server-only";
import type { ApiErrorCode } from "@shortloop/contracts";
import {
  CreateShortInput,
  EstimateInput,
  getWorkflow,
  listWorkflows,
  ToolUserError,
  type ShortLoopServices,
} from "@shortloop/mcp";
import { ZodError, type z } from "zod";
import { UserError } from "../errors";
import { mcpServicesFor } from "../mcp-services";
import { runtime } from "../runtime";
import { authenticateApiKey } from "./keys";
import { hitRateLimit, rateLimitFromEnv, type RateDecision } from "./rate-limit";
import {
  buildOpenApi,
  JobQuery,
  OPERATIONS,
  PublishBody,
  RATE_LIMIT_PER_MINUTE,
  SwapBody,
  TrendsQuery,
  type Operation,
} from "./spec";
import { createWebhook, deleteWebhook, listDeliveries, listWebhooks } from "./webhooks";

/** The public REST API (E12-01): `/api/v1/*` → the same services the web app and MCP server use. */

export const API_BASE = "/api/v1";

interface Ctx {
  userId: string;
  services: ShortLoopServices;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  pollMs: number;
}

const jobNext = (jobId: string) => `GET ${API_BASE}/jobs/${jobId}?wait=50 until done is true.`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const queryObject = (q: URLSearchParams) => Object.fromEntries(q.entries());
const param = (ctx: Ctx, name: string) => ctx.params[name] ?? "";

const HANDLERS: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  async createShort(ctx) {
    const out = await ctx.services.createShort(CreateShortInput.parse(ctx.body));
    return { ...out, next: jobNext(out.job_id) };
  },
  async approveShort(ctx) {
    return ctx.services.approveShort(param(ctx, "project_id"));
  },
  async swapVisual(ctx) {
    const body = SwapBody.parse(ctx.body);
    return ctx.services.swapVisual({ ...body, project_id: param(ctx, "project_id") });
  },
  async publishShort(ctx) {
    const body = PublishBody.parse(ctx.body ?? {});
    const out = await ctx.services.publishShort({ ...body, project_id: param(ctx, "project_id") });
    return { ...out, next: jobNext(out.job_id) };
  },
  async getJob(ctx) {
    const { wait } = JobQuery.parse(queryObject(ctx.query));
    const jobId = param(ctx, "job_id");
    const deadline = Date.now() + wait * 1000;
    let view = await ctx.services.getJob(jobId);
    while (!view.done && Date.now() + ctx.pollMs < deadline) {
      await sleep(ctx.pollMs);
      view = await ctx.services.getJob(jobId);
    }
    return view;
  },
  async listVoices(ctx) {
    return { voices: await ctx.services.listVoices() };
  },
  async listCaptionStyles(ctx) {
    return { styles: await ctx.services.listCaptionStyles() };
  },
  async estimateCost(ctx) {
    return ctx.services.estimateCost(EstimateInput.parse(ctx.body ?? {}));
  },
  async getBalance(ctx) {
    return ctx.services.getCreditBalance();
  },
  async getTrends(ctx) {
    return ctx.services.getTrends(TrendsQuery.parse(queryObject(ctx.query)));
  },
  async listWorkflows() {
    return { workflows: listWorkflows() };
  },
  async getWorkflow(ctx) {
    const slug = param(ctx, "slug");
    const phase = param(ctx, "phase");
    return { slug, phase, markdown: getWorkflow(slug, phase) };
  },
  async listWebhooks(ctx) {
    return { webhooks: await listWebhooks(ctx.userId) };
  },
  async createWebhook(ctx) {
    return createWebhook(ctx.userId, ctx.body);
  },
  async deleteWebhook(ctx) {
    const id = param(ctx, "webhook_id");
    await deleteWebhook(ctx.userId, id);
    return { id, deleted: true };
  },
  async listDeliveries(ctx) {
    return { deliveries: await listDeliveries(ctx.userId, param(ctx, "webhook_id")) };
  },
};

interface Compiled {
  op: Operation;
  re: RegExp;
  names: string[];
}

const COMPILED: Compiled[] = OPERATIONS.map((op) => {
  const names: string[] = [];
  const pattern = op.path.replace(/[.]/g, "\\.").replace(/\{(\w+)\}/g, (_m, n: string) => {
    names.push(n);
    return "([^/]+)";
  });
  return { op, re: new RegExp(`^${pattern}$`), names };
});

function match(
  path: string,
  method: string,
): { hit?: Compiled; params: Record<string, string>; allowed: string[] } {
  const allowed: string[] = [];
  for (const c of COMPILED) {
    const m = c.re.exec(path);
    if (!m) continue;
    allowed.push(c.op.method.toUpperCase());
    if (c.op.method === method) {
      let params: Record<string, string>;
      try {
        params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? "")]));
      } catch {
        return { params: {}, allowed: [] };
      }
      return { hit: c, params, allowed };
    }
  }
  return { params: {}, allowed };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  internal: 500,
};

function apiError(code: ApiErrorCode, message: string, headers: Record<string, string> = {}): Response {
  return json(STATUS[code], { error: { code, message } }, headers);
}

const NOT_FOUND = /not found|^Unknown (job|upload|API key)|^No workflow/i;

function rateHeaders(d: RateDecision): Record<string, string> {
  return {
    "x-ratelimit-limit": String(d.limit),
    "x-ratelimit-remaining": String(d.remaining),
    "x-ratelimit-reset": String(d.resetAt),
  };
}

export interface ApiOptions {
  /** Services for a user (tests pass fakes). Defaults to the MCP services, i.e. the web app's own code. */
  servicesFor?: (userId: string) => ShortLoopServices;
  /** Requests per key per minute; defaults to API_RATE_LIMIT_PER_MINUTE or 60. */
  rateLimit?: number;
  /** Poll interval for `?wait=` (ms). */
  pollMs?: number;
  onError?: (e: unknown) => void;
}

/** Handle one `/api/v1/*` request. */
export async function handleApiRequest(req: Request, opts: ApiOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(API_BASE) ? url.pathname.slice(API_BASE.length) || "/" : url.pathname;
  const method = req.method.toLowerCase();
  const { hit, params, allowed } = match(path, method);
  if (!hit) {
    return allowed.length
      ? apiError("method_not_allowed", `Use ${allowed.join(" or ")} for this path.`, {
          allow: allowed.join(", "),
        })
      : apiError("not_found", "No such endpoint. See /api/v1/openapi.json.");
  }
  if (hit.op.public) return json(200, buildOpenApi());

  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    return apiError("unauthorized", "Send a ShortLoop API key as `Authorization: Bearer sl_...`.", {
      "www-authenticate": 'Bearer realm="shortloop"',
    });
  }
  const { db } = await runtime();
  const decision = await hitRateLimit(
    db,
    auth.keyId,
    opts.rateLimit ?? rateLimitFromEnv(RATE_LIMIT_PER_MINUTE),
  );
  const headers = rateHeaders(decision);
  if (!decision.ok) {
    return apiError("rate_limited", `Rate limit of ${decision.limit} requests per minute reached.`, {
      ...headers,
      "retry-after": String(decision.retryAfter),
    });
  }

  let body: unknown = undefined;
  if (hit.op.body) {
    const text = await req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return apiError("invalid_request", "The body must be JSON.", headers);
      }
    }
    if (body === undefined) body = {};
  }
  if (hit.op.params) {
    const p = (hit.op.params as z.ZodObject).safeParse(params);
    if (!p.success) return apiError("invalid_request", p.error.issues[0]?.message ?? "Invalid path", headers);
  }

  const services = (opts.servicesFor ?? mcpServicesFor)(auth.userId);
  const handler = HANDLERS[hit.op.id];
  if (!handler) return apiError("not_found", "No such endpoint.", headers);
  try {
    const out = await handler({
      userId: auth.userId,
      services,
      params,
      query: url.searchParams,
      body,
      pollMs: opts.pollMs ?? 1000,
    });
    return json(hit.op.response.status, out, headers);
  } catch (e) {
    if (e instanceof ZodError) {
      const issue = e.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return apiError("invalid_request", `${where}${issue?.message ?? "Invalid request"}`, headers);
    }
    const known =
      e instanceof UserError ||
      e instanceof ToolUserError ||
      (e instanceof Error && e.name === "ToolUserError");
    if (known) {
      const message = (e as Error).message;
      return apiError(NOT_FOUND.test(message) ? "not_found" : "invalid_request", message, headers);
    }
    (opts.onError ?? ((x: unknown) => console.error("[api]", x)))(e);
    return apiError("internal", "Something went wrong on ShortLoop's side. Try again in a moment.", headers);
  }
}

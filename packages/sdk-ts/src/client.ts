import { GeneratedClient, type ApiError, type JobView, type RequestSpec } from "./generated";

export interface ShortLoopOptions {
  /** `sl_…` key from ShortLoop → Settings → Developer. Defaults to `SHORTLOOP_API_KEY`. */
  apiKey?: string;
  /** e.g. `https://<your ShortLoop app>/api/v1`. Defaults to `SHORTLOOP_API_URL`. */
  baseUrl?: string;
  /** Custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** How many times to retry a 429 after its `Retry-After` (default 2). */
  maxRetries?: number;
  /** Longest single `Retry-After` wait we'll honour, in seconds (default 60). */
  maxRetryAfterSeconds?: number;
  /** Override sleeping (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Any non-2xx answer. `code` and `message` come from the API's error envelope. */
export class ShortLoopError extends Error {
  override readonly name = "ShortLoopError";
  constructor(
    readonly status: number,
    readonly code: ApiError["error"]["code"] | "unknown",
    message: string,
    readonly operationId: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Thrown by `waitForJob` when the job ended `failed`; `job.error` says why (credits are refunded). */
export class JobFailedError extends Error {
  override readonly name = "JobFailedError";
  constructor(readonly job: JobView) {
    super(job.error ?? `Job ${job.job_id} failed`);
  }
}

const env = (k: string): string | undefined =>
  typeof process !== "undefined" ? process.env[k] || undefined : undefined;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The ShortLoop API client. Every endpoint is a method (generated from the OpenAPI spec), plus
 * `waitForJob` for the long-running ones.
 *
 * ```ts
 * const sl = new ShortLoop({ apiKey: process.env.SHORTLOOP_API_KEY, baseUrl: "https://<app>/api/v1" });
 * const { project_id, job_id } = await sl.createShort({ topic: "why octopuses have three hearts" });
 * const job = await sl.waitForJob(job_id);
 * ```
 */
export class ShortLoop extends GeneratedClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly maxRetryAfter: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ShortLoopOptions = {}) {
    super();
    const apiKey = opts.apiKey ?? env("SHORTLOOP_API_KEY");
    const baseUrl = opts.baseUrl ?? env("SHORTLOOP_API_URL");
    if (!apiKey) throw new Error("ShortLoop: pass apiKey or set SHORTLOOP_API_KEY (Settings → Developer).");
    if (!baseUrl)
      throw new Error("ShortLoop: pass baseUrl or set SHORTLOOP_API_URL, e.g. https://<app>/api/v1.");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxRetryAfter = opts.maxRetryAfterSeconds ?? 60;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  protected async request<T>(spec: RequestSpec): Promise<T> {
    const url = new URL(this.baseUrl + spec.path);
    for (const [k, v] of Object.entries(spec.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
    };
    const init: RequestInit = { method: spec.method, headers };
    if (spec.method !== "GET") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(spec.body ?? {});
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url.toString(), init);
      const text = await res.text();
      const json: unknown = text ? safeJson(text) : undefined;
      if (res.ok) return json as T;
      const retryAfter = Number(res.headers.get("retry-after") ?? NaN);
      if (
        res.status === 429 &&
        attempt < this.maxRetries &&
        Number.isFinite(retryAfter) &&
        retryAfter <= this.maxRetryAfter
      ) {
        await this.sleep(Math.max(0, retryAfter) * 1000);
        continue;
      }
      const err = (json as Partial<ApiError> | undefined)?.error;
      throw new ShortLoopError(
        res.status,
        err?.code ?? "unknown",
        err?.message ?? `HTTP ${res.status} from ${spec.operationId}`,
        spec.operationId,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
  }

  /**
   * Wait until a production or publish job is done (`done: true`), holding each request up to 50 s on the
   * server. Throws if the job failed, or after `timeoutMs` (default 10 minutes).
   */
  async waitForJob(jobId: string, opts: { timeoutMs?: number; waitSeconds?: number } = {}): Promise<JobView> {
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const job = await this.getJob(jobId, { wait: opts.waitSeconds ?? 50 });
      if (job.done) {
        if (job.status === "failed") throw new JobFailedError(job);
        return job;
      }
      if (Date.now() > deadline) throw new Error(`ShortLoop: job ${jobId} still ${job.status} after timeout`);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

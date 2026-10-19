import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { JsonRequest, LLM } from "./llm";

/**
 * Record/replay for LLM calls. `RecordingLLM` wraps a real (or fake) model and writes one JSON file per call;
 * `CassetteLLM` replays those files by request hash, so prompt changes are tested against recorded model
 * behaviour with no network. Only the request content and the parsed reply are stored: never headers or keys.
 */

/** What gets hashed (and stored) for a request. */
export interface CassetteRequest {
  model: string;
  system: string;
  messages: { role: "user"; content: string }[];
  schema: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface CassetteFile {
  requestHash: string;
  model: string;
  recordedWith: "fake" | "real";
  recordedAt: string;
  request: CassetteRequest;
  response: unknown;
}

const CassetteFileSchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().min(1),
  recordedWith: z.enum(["fake", "real"]),
  recordedAt: z.string(),
  request: z.object({
    model: z.string(),
    system: z.string(),
    messages: z.array(z.object({ role: z.literal("user"), content: z.string() })),
    schema: z.unknown(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
  }),
  response: z.unknown(),
});

export const RECORD_HINT = "run `pnpm -F pipeline record:script` to re-record the cassettes";

export class CassetteMiss extends Error {
  constructor(readonly requestHash: string) {
    super(`no cassette for LLM request ${requestHash}: the prompt or schema changed; ${RECORD_HINT}`);
    this.name = "CassetteMiss";
  }
}

/** Patterns that must never appear in a cassette. `sk-` is matched as a token start so words like "task-based" pass. */
const SECRET_PATTERNS: RegExp[] = [/api_key/i, /authorization/i, /x-api-key/i, /(^|[^a-z0-9])sk-/i];

/** Returns the secret-looking patterns found in `text` (empty when clean). */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function toCassetteRequest<T>(model: string, req: JsonRequest<T>): CassetteRequest {
  return {
    model,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    schema: z.toJSONSchema(req.schema),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
}

/** SHA-256 over the canonical JSON of model, system, messages and schema (generation settings excluded). */
export function hashRequest(req: Pick<CassetteRequest, "model" | "system" | "messages" | "schema">): string {
  const body = canonical({
    model: req.model,
    system: req.system,
    messages: req.messages,
    schema: req.schema,
  });
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/** Delegates to `inner`, then writes `<dir>/<hash prefix>.json` for each call. */
export class RecordingLLM implements LLM {
  readonly provider: string;
  readonly model: string;
  readonly recorded: string[] = [];

  constructor(
    private readonly inner: LLM,
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const response = await this.inner.json(req);
    const request = toCassetteRequest(this.inner.model, req);
    const requestHash = hashRequest(request);
    const file: CassetteFile = {
      requestHash,
      model: this.inner.model,
      recordedWith: this.inner.provider === "fake" ? "fake" : "real",
      recordedAt: this.now().toISOString(),
      request,
      response,
    };
    const text = `${JSON.stringify(file, null, 2)}\n`;
    const leaks = findSecrets(text);
    if (leaks.length)
      throw new Error(`refusing to write a cassette that matches secret patterns: ${leaks.join(", ")}`);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${requestHash.slice(0, 16)}.json`), text);
    this.recorded.push(requestHash);
    return response;
  }
}

/** Reads every cassette in `dir`. */
export function loadCassettes(dir: string): CassetteFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = CassetteFileSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`cassette ${f} is malformed: ${parsed.error.message}`);
      return parsed.data as CassetteFile;
    });
}

/**
 * Replays cassettes by request hash. The model is the one the cassettes were recorded with (they must agree),
 * so re-recording with a real model needs no code change. Unknown requests throw `CassetteMiss`.
 */
export class CassetteLLM implements LLM {
  readonly provider = "cassette";
  readonly model: string;
  private readonly byHash = new Map<string, CassetteFile>();

  constructor(dir: string) {
    const files = loadCassettes(dir);
    const models = [...new Set(files.map((f) => f.model))];
    if (models.length !== 1)
      throw new Error(
        models.length === 0
          ? `no cassettes in ${dir}; ${RECORD_HINT}`
          : `cassettes in ${dir} mix models (${models.join(", ")}); ${RECORD_HINT}`,
      );
    this.model = models[0] as string;
    for (const f of files) this.byHash.set(f.requestHash, f);
  }

  get size(): number {
    return this.byHash.size;
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const requestHash = hashRequest(toCassetteRequest(this.model, req));
    const hit = this.byHash.get(requestHash);
    if (!hit) throw new CassetteMiss(requestHash);
    return req.schema.parse(hit.response);
  }
}

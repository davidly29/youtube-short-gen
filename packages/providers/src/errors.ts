import type { ProviderCapability, ProviderErrorKind } from "@shortloop/contracts";

/**
 * Provider errors in terms the user can act on (ADR 0007). Adapters throw these for HTTP failures; the job queue
 * treats `permanent` ones (bad key, no quota, blocked prompt) as final instead of burning retries.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly capability: ProviderCapability;
  readonly status?: number;
  /** How long the provider asked us to wait before retrying (rate limits). */
  readonly retryAfterMs?: number;
  /** The key has no access to this job at all (e.g. Gemini images on the free tier: quota limit 0). */
  readonly noAccess: boolean;
  /** The provider's own message, trimmed. Never contains the key. */
  readonly detail: string;

  constructor(init: {
    kind: ProviderErrorKind;
    provider: string;
    capability: ProviderCapability;
    status?: number;
    retryAfterMs?: number;
    noAccess?: boolean;
    detail?: string;
    message?: string;
  }) {
    const detail = (init.detail ?? "").slice(0, 300);
    super(
      init.message ?? userMessage(init.provider, init.capability, init.kind, init.noAccess ?? false, detail),
    );
    this.name = "ProviderError";
    this.kind = init.kind;
    this.provider = init.provider;
    this.capability = init.capability;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.noAccess = init.noAccess ?? false;
    this.detail = detail;
  }

  /** Retrying won't help: the user (or their billing) has to change something. */
  get permanent(): boolean {
    return this.kind === "auth" || this.kind === "quota" || this.kind === "blocked";
  }
}

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  elevenlabs: "ElevenLabs",
  fal: "fal.ai",
  pexels: "Pexels",
  pixabay: "Pixabay",
  pollinations: "Pollinations",
  edge: "Edge voices",
  shortloop: "ShortLoop AI",
};

/** Where the user fixes billing or keys for each provider. */
export const PROVIDER_CONSOLE: Record<string, string> = {
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com",
  gemini: "aistudio.google.com",
  elevenlabs: "elevenlabs.io",
  fal: "fal.ai/dashboard",
  pexels: "pexels.com/api",
  pixabay: "pixabay.com/api/docs",
};

const JOB: Record<ProviderCapability, string> = {
  llm: "scripts",
  image: "images",
  tts: "voices",
  stock: "stock footage",
};

function userMessage(
  provider: string,
  capability: ProviderCapability,
  kind: ProviderErrorKind,
  noAccess: boolean,
  detail: string,
): string {
  const name = PROVIDER_LABEL[provider] ?? provider;
  const where = PROVIDER_CONSOLE[provider];
  const billing = where ? ` Check billing at ${where}` : "";
  switch (kind) {
    case "auth":
      return `${name} rejected your API key. Check or replace it in Settings → API keys.`;
    case "quota":
      if (noAccess && provider === "gemini" && capability === "image")
        return "Your Gemini key can't make images: Google's free tier has no image quota. Turn on billing for that Google Cloud project, or pick another image provider in Settings → API keys.";
      if (noAccess)
        return `Your ${name} key doesn't include ${JOB[capability]} on its current plan.${billing}, or pick another provider in Settings → API keys.`;
      return `Your ${name} account is out of quota or credit for ${JOB[capability]}.${billing}, or pick another provider in Settings → API keys.`;
    case "rate_limit":
      return `${name} is rate-limiting your key right now. Wait a minute and try again.`;
    case "unavailable":
      return `${name} is having problems right now. Try again in a few minutes.`;
    case "blocked":
      return `${name} refused this request${detail ? ` (${detail.slice(0, 120)})` : ""}. Try rewording it.`;
    default:
      return `${name} returned an error${detail ? `: ${detail.slice(0, 160)}` : ""}.`;
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: {
      "@type"?: string;
      retryDelay?: string;
      violations?: { quotaId?: string; quotaValue?: string; quotaMetric?: string }[];
    }[];
  };
}

const seconds = (s: string | undefined | null): number | undefined => {
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)s?$/.exec(s.trim());
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Classify a failed HTTP response from any provider. `body` is the raw response text. */
export function classifyHttpError(init: {
  provider: string;
  capability: ProviderCapability;
  status: number;
  body: string;
  retryAfter?: string | null;
}): ProviderError {
  const { provider, capability, status } = init;
  const json = parseJson(init.body) as (GoogleErrorBody & Record<string, unknown>) | undefined;
  const nested = json?.error as Record<string, unknown> | string | undefined;
  const message =
    (typeof nested === "object" && typeof nested?.message === "string" ? nested.message : undefined) ??
    (typeof nested === "string" ? nested : undefined) ??
    (typeof json?.detail === "string"
      ? json.detail
      : typeof (json?.detail as Record<string, unknown>)?.message === "string"
        ? ((json?.detail as Record<string, unknown>).message as string)
        : undefined) ??
    (typeof json?.message === "string" ? json.message : undefined) ??
    init.body;
  const detail = message.replace(/\s+/g, " ").trim().slice(0, 300);
  const text = `${init.body}`.toLowerCase();
  const base = { provider, capability, status, detail };

  // Google: details carry QuotaFailure (which quota, its value) and RetryInfo (how long to wait).
  const details = json?.error?.details ?? [];
  const violations = details.flatMap((d) => d.violations ?? []);
  const retryInfo = details.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const retryAfterMs = seconds(retryInfo) ?? seconds(init.retryAfter);

  if (status === 401 || status === 403) {
    if (/quota|exhausted balance|insufficient|credits?/.test(text) && !/invalid|api key not valid/.test(text))
      return new ProviderError({ ...base, kind: "quota" });
    return new ProviderError({ ...base, kind: "auth" });
  }
  if (status === 402) return new ProviderError({ ...base, kind: "quota" });
  if (status === 400) {
    if (/api key not valid|invalid api key|invalid x-api-key|api_key_invalid/.test(text))
      return new ProviderError({ ...base, kind: "auth" });
    if (/credit balance is too low|insufficient_quota|billing/.test(text))
      return new ProviderError({ ...base, kind: "quota" });
    if (/safety|blocked|content policy|moderation/.test(text))
      return new ProviderError({ ...base, kind: "blocked" });
    return new ProviderError({ ...base, kind: "other" });
  }
  if (status === 429) {
    const noAccess =
      violations.some((v) => v.quotaValue === "0") ||
      /limit:\s*0\b/.test(text) ||
      /free_tier.*limit:\s*0/.test(text);
    if (noAccess) return new ProviderError({ ...base, kind: "quota", noAccess: true });
    if (/insufficient_quota|exceeded your current quota.*billing|credit/.test(text) && provider !== "gemini")
      return new ProviderError({ ...base, kind: "quota" });
    if (violations.some((v) => /perday/i.test(v.quotaId ?? "")))
      return new ProviderError({ ...base, kind: "quota", retryAfterMs });
    return new ProviderError({ ...base, kind: "rate_limit", retryAfterMs });
  }
  if (status === 408 || status >= 500)
    return new ProviderError({ ...base, kind: "unavailable", retryAfterMs });
  return new ProviderError({ ...base, kind: "other" });
}

/** Build a ProviderError from a non-OK fetch Response (reads the body). */
export async function httpError(
  provider: string,
  capability: ProviderCapability,
  res: Response,
): Promise<ProviderError> {
  const body = await res.text().catch(() => "");
  return classifyHttpError({
    provider,
    capability,
    status: res.status,
    body,
    retryAfter: res.headers.get("retry-after"),
  });
}

/**
 * Normalise anything an adapter threw. SDK errors (Anthropic, OpenAI) carry `status`; network failures become
 * `unavailable`. Errors that aren't about the provider (e.g. bad JSON from the model) are returned unchanged.
 */
export function toProviderError(provider: string, capability: ProviderCapability, err: unknown): unknown {
  if (err instanceof ProviderError) return err;
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; message?: unknown; error?: unknown; headers?: unknown };
    if (typeof e.status === "number") {
      const body = e.error ? JSON.stringify(e.error) : String(e.message ?? "");
      const headers = e.headers as
        { get?: (k: string) => string | null } | Record<string, string> | undefined;
      const retryAfter =
        typeof (headers as { get?: unknown })?.get === "function"
          ? (headers as { get: (k: string) => string | null }).get("retry-after")
          : ((headers as Record<string, string> | undefined)?.["retry-after"] ?? null);
      return classifyHttpError({ provider, capability, status: e.status, body, retryAfter });
    }
    if (err instanceof TypeError && /fetch failed|network|ECONN|ETIMEDOUT|socket/i.test(err.message))
      return new ProviderError({ kind: "unavailable", provider, capability, detail: err.message });
  }
  return err;
}

import type { ProviderCapability } from "@shortloop/contracts";
import { estimateTokens } from "@shortloop/contracts";
import { ProviderError, toProviderError } from "./errors";
import { ImagePromptRejected, type ImageGen, type ImageRequest, type ImageResult } from "./image/image";
import type { JsonRequest, LLM } from "./llm/llm";
import type { SynthesizeRequest, SynthesizeResult, TTS, Voice } from "./tts/tts";

/**
 * Wrappers around provider adapters (ADR 0007):
 * - retry rate limits and outages, honouring the provider's retry delay (up to 3 attempts);
 * - report every call's outcome so key health can be shown in Settings;
 * - for ShortLoop AI, check the budget before each call and meter its estimated cost after;
 * - fall back from the user's (or ShortLoop's) provider to the free one for images and voices.
 */

/** Whose key a call runs on. */
export type KeySource = "own" | "shortloop" | "free" | "platform";

export interface ProviderEvent {
  provider: string;
  capability: ProviderCapability;
  source: KeySource;
  ok: boolean;
  error?: ProviderError;
}

export interface UsageRecord {
  capability: ProviderCapability;
  provider: string;
  model: string;
  units: number;
  costUsd: number;
}

export interface Instrumentation {
  source: KeySource;
  /** Called after every call (success or provider error). Errors in the reporter are swallowed. */
  report?: (e: ProviderEvent) => unknown;
  /**
   * ShortLoop AI only: resolves to a user-facing reason when the call isn't allowed (budget, caps, kill switch).
   * A denial throws a permanent `quota` ProviderError, which the fallback wrappers turn into the free provider.
   */
  guard?: (capability: ProviderCapability) => Promise<string | undefined>;
  /** ShortLoop AI only: record the estimated cost of a successful call. */
  meter?: (u: UsageRecord) => Promise<unknown>;
  /** Estimated USD for a call; see `costOf` in contracts. */
  price?: (u: { inputTokens?: number; outputTokens?: number; images?: number; chars?: number }) => number;
  sleep?: (ms: number) => Promise<void>;
  /** Default 3 (first try + 2 retries). */
  attempts?: number;
  /** Don't wait longer than this for one retry; give up instead (default 30 s). */
  maxDelayMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry rate limits and outages up to `attempts` times, waiting what the provider asked (or 1 s, 2 s, ...). */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Pick<Instrumentation, "sleep" | "attempts" | "maxDelayMs"> & {
    provider: string;
    capability: ProviderCapability;
  },
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? realSleep;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (raw) {
      const err = toProviderError(opts.provider, opts.capability, raw);
      if (!(err instanceof ProviderError)) throw err;
      const retryable = err.kind === "rate_limit" || err.kind === "unavailable";
      const delay = err.retryAfterMs ?? 1000 * 2 ** (i - 1);
      if (!retryable || i >= attempts || delay > maxDelay) throw err;
      await sleep(delay);
    }
  }
}

async function safely(f: (() => unknown) | undefined) {
  try {
    await f?.();
  } catch {
    // health and metering must never break a job
  }
}

async function run<T>(
  provider: string,
  model: string,
  capability: ProviderCapability,
  ins: Instrumentation,
  call: () => Promise<T>,
  units: (result: T) => { units: number; cost: Parameters<NonNullable<Instrumentation["price"]>>[0] },
): Promise<T> {
  const denial = await ins.guard?.(capability);
  if (denial)
    throw new ProviderError({
      kind: "quota",
      provider: "shortloop",
      capability,
      detail: denial,
      message: denial,
    });
  try {
    const result = await withRetry(call, { ...ins, provider, capability });
    await safely(() => ins.report?.({ provider, capability, source: ins.source, ok: true }));
    if (ins.meter) {
      const u = units(result);
      await safely(() =>
        ins.meter?.({ capability, provider, model, units: u.units, costUsd: ins.price?.(u.cost) ?? 0 }),
      );
    }
    return result;
  } catch (err) {
    if (err instanceof ProviderError)
      await safely(() => ins.report?.({ provider, capability, source: ins.source, ok: false, error: err }));
    // A failure on ShortLoop's own key is our operations problem, not the user's billing: say so, and don't make
    // it a permanent failure of their job. (The original error went to `report`, which alerts Sentry.)
    if (ins.source === "shortloop" && err instanceof ProviderError && err.kind !== "blocked")
      throw new ProviderError({
        kind: "unavailable",
        provider: "shortloop",
        capability,
        detail: err.detail,
        message: SHORTLOOP_TROUBLE[capability],
      });
    throw err;
  }
}

const SHORTLOOP_TROUBLE: Record<ProviderCapability, string> = {
  llm: "ShortLoop AI can't write scripts right now. Try again in a few minutes, or add your own AI key in Settings → API keys.",
  image: "ShortLoop AI images aren't available right now, so the free images were used.",
  tts: "ShortLoop AI voices aren't available right now, so the free voices were used.",
  stock: "ShortLoop stock search isn't available right now.",
};

export class InstrumentedLLM implements LLM {
  readonly provider: string;
  readonly model: string;
  constructor(
    private readonly inner: LLM,
    private readonly ins: Instrumentation,
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }
  json<T>(req: JsonRequest<T>): Promise<T> {
    const input = estimateTokens(req.system + req.prompt);
    return run(
      this.provider,
      this.model,
      "llm",
      this.ins,
      () => this.inner.json(req),
      (out) => {
        const output = estimateTokens(JSON.stringify(out));
        return { units: input + output, cost: { inputTokens: input, outputTokens: output } };
      },
    );
  }
}

export class InstrumentedImage implements ImageGen {
  readonly provider: string;
  constructor(
    private readonly inner: ImageGen & { model?: string },
    private readonly ins: Instrumentation,
  ) {
    this.provider = inner.provider;
  }
  get model(): string {
    return this.inner.model ?? this.inner.provider;
  }
  generate(req: ImageRequest): Promise<ImageResult> {
    return run(
      this.provider,
      this.model,
      "image",
      this.ins,
      () => this.inner.generate(req),
      () => ({
        units: 1,
        cost: { images: 1 },
      }),
    );
  }
}

export class InstrumentedTTS implements TTS {
  readonly provider: string;
  constructor(
    private readonly inner: TTS & { model?: string },
    private readonly ins: Instrumentation,
  ) {
    this.provider = inner.provider;
  }
  voices(): Voice[] {
    return this.inner.voices();
  }
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    return run(
      this.provider,
      this.inner.model ?? this.inner.provider,
      "tts",
      this.ins,
      () => this.inner.synthesize(req),
      () => ({ units: req.text.length, cost: { chars: req.text.length } }),
    );
  }
}

/** Called when a fallback is used, with the error that caused it. */
export type OnFallback = (e: {
  capability: ProviderCapability;
  from: string;
  to: string;
  error: unknown;
}) => unknown;

/**
 * After this, the rest of the job skips the primary: a bad key or no quota won't fix itself, and ShortLoop AI that
 * failed or was denied by a guardrail stays that way for this job. A blocked prompt is about one prompt, not the
 * provider, so it doesn't count.
 */
const skipsProvider = (err: unknown) =>
  err instanceof ProviderError &&
  (err.kind === "auth" || err.kind === "quota" || err.provider === "shortloop");

/**
 * Never fall back on our own prompt rules, or on a provider refusing a prompt for safety: retrying the same
 * prompt on a provider with weaker moderation would sidestep the refusal. That beat goes without an AI image.
 */
const fallsBack = (err: unknown) =>
  !(err instanceof ImagePromptRejected) && !(err instanceof ProviderError && err.kind === "blocked");

/** Try the primary image provider; on any provider failure use the fallback (the free provider). */
export class FallbackImage implements ImageGen {
  readonly provider: string;
  /** Set after a permanent failure (bad key, no quota): later calls go straight to the fallback. */
  private skipPrimary = false;
  constructor(
    readonly primary: ImageGen,
    readonly fallback: ImageGen,
    private readonly onFallback?: OnFallback,
  ) {
    this.provider = primary.provider;
  }
  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.skipPrimary) {
      try {
        return await this.primary.generate(req);
      } catch (err) {
        if (!fallsBack(err)) throw err;
        if (skipsProvider(err)) this.skipPrimary = true;
        await safely(() =>
          this.onFallback?.({
            capability: "image",
            from: this.primary.provider,
            to: this.fallback.provider,
            error: err,
          }),
        );
      }
    }
    return this.fallback.generate(req);
  }
}

/** Try the primary voice provider; on failure use the fallback with its default voice. */
export class FallbackTTS implements TTS {
  readonly provider: string;
  private skipPrimary = false;
  constructor(
    readonly primary: TTS,
    readonly fallback: TTS,
    private readonly onFallback?: OnFallback,
  ) {
    this.provider = primary.provider;
  }
  voices(): Voice[] {
    return this.primary.voices();
  }
  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    if (!this.skipPrimary) {
      try {
        const r = await this.primary.synthesize(req);
        return { ...r, provider: r.provider ?? this.primary.provider };
      } catch (err) {
        if (!fallsBack(err)) throw err;
        if (skipsProvider(err)) this.skipPrimary = true;
        await safely(() =>
          this.onFallback?.({
            capability: "tts",
            from: this.primary.provider,
            to: this.fallback.provider,
            error: err,
          }),
        );
      }
    }
    const known = this.fallback.voices().some((v) => v.id === req.voiceId);
    const voiceId = known ? req.voiceId : (this.fallback.voices()[0]?.id ?? req.voiceId);
    const r = await this.fallback.synthesize({ ...req, voiceId });
    return { ...r, provider: r.provider ?? this.fallback.provider, voiceId };
  }
}

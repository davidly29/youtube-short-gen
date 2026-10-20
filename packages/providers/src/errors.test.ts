import { describe, expect, it } from "vitest";
import { classifyHttpError, ProviderError, toProviderError } from "./errors";

/** Shaped like Google's real 429 for an image model on a free-tier key. */
const GEMINI_FREE_TIER_IMAGE = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaValue: "0",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
    ],
  },
});

const GEMINI_PER_MINUTE = JSON.stringify({
  error: {
    code: 429,
    message: "Resource exhausted. Please try again later.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "10" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12s" },
    ],
  },
});

const GEMINI_PER_DAY = JSON.stringify({
  error: {
    code: 429,
    message: "Quota exceeded",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }],
      },
    ],
  },
});

const c = (provider: string, status: number, body: string, capability: "llm" | "image" | "tts" = "image") =>
  classifyHttpError({ provider, capability, status, body });

describe("classifyHttpError", () => {
  it("Gemini free tier with image quota 0: quota, no access, permanent, tells the user to enable billing", () => {
    const e = c("gemini", 429, GEMINI_FREE_TIER_IMAGE);
    expect(e).toMatchObject({ kind: "quota", noAccess: true, provider: "gemini", capability: "image" });
    expect(e.permanent).toBe(true);
    expect(e.message).toMatch(/free tier has no image quota/);
    expect(e.message).toMatch(/Turn on billing/);
  });

  it("Gemini per-minute limit: rate limit with Google's retry delay", () => {
    const e = c("gemini", 429, GEMINI_PER_MINUTE, "llm");
    expect(e).toMatchObject({ kind: "rate_limit", retryAfterMs: 12_000, noAccess: false });
    expect(e.permanent).toBe(false);
  });

  it("Gemini daily quota used up: quota (waiting minutes won't help)", () => {
    expect(c("gemini", 429, GEMINI_PER_DAY, "llm")).toMatchObject({ kind: "quota", noAccess: false });
  });

  it("OpenAI insufficient_quota is quota; a plain 429 is a rate limit using Retry-After", () => {
    expect(
      c(
        "openai",
        429,
        JSON.stringify({
          error: {
            code: "insufficient_quota",
            message: "You exceeded your current quota, please check your plan and billing details.",
          },
        }),
        "llm",
      ),
    ).toMatchObject({ kind: "quota" });
    expect(
      classifyHttpError({
        provider: "anthropic",
        capability: "llm",
        status: 429,
        body: "{}",
        retryAfter: "7",
      }),
    ).toMatchObject({ kind: "rate_limit", retryAfterMs: 7000 });
  });

  it("bad keys are auth errors, including Gemini's 400 'API key not valid'", () => {
    expect(c("fal", 401, "Unauthorized")).toMatchObject({ kind: "auth" });
    expect(
      c(
        "gemini",
        400,
        JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }),
      ),
    ).toMatchObject({
      kind: "auth",
      detail: "API key not valid. Please pass a valid API key.",
    });
  });

  it("out of credit: Anthropic 400, fal 403 exhausted balance, ElevenLabs 401 quota_exceeded", () => {
    expect(
      c("anthropic", 400, JSON.stringify({ error: { message: "Your credit balance is too low" } }), "llm"),
    ).toMatchObject({ kind: "quota" });
    expect(
      c("fal", 403, JSON.stringify({ detail: "User is locked. Reason: Exhausted balance." })),
    ).toMatchObject({ kind: "quota" });
    expect(
      c(
        "elevenlabs",
        401,
        JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }),
        "tts",
      ),
    ).toMatchObject({
      kind: "quota",
    });
  });

  it("5xx and Anthropic's 529 overloaded are 'unavailable' and retryable", () => {
    const e = c("anthropic", 529, "overloaded", "llm");
    expect(e).toMatchObject({ kind: "unavailable" });
    expect(e.permanent).toBe(false);
    expect(c("pollinations", 503, "")).toMatchObject({ kind: "unavailable" });
  });

  it("messages never contain anything but the provider's own text", () => {
    const e = c("gemini", 400, JSON.stringify({ error: { message: "x".repeat(1000) } }));
    expect(e.detail.length).toBeLessThanOrEqual(300);
  });
});

describe("toProviderError", () => {
  it("maps SDK errors by status and leaves non-provider errors alone", () => {
    const sdk = Object.assign(new Error("429 rate limited"), {
      status: 429,
      error: { type: "rate_limit_error" },
    });
    expect(toProviderError("anthropic", "llm", sdk)).toMatchObject({ kind: "rate_limit" });
    const plain = new Error("model returned bad JSON");
    expect(toProviderError("anthropic", "llm", plain)).toBe(plain);
    expect(toProviderError("gemini", "llm", new TypeError("fetch failed"))).toBeInstanceOf(ProviderError);
  });
});

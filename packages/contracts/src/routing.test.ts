import { describe, expect, it } from "vitest";
import { ApiKeyInfo, ProviderRouting, resolveRouting, type RoutableKey } from "./keys";
import { costOf, MANAGED_LIMITS, AiUsage } from "./managed";

const key = (
  provider: RoutableKey["provider"],
  updatedAt = "2026-10-19T10:00:00Z",
  unavailable = [],
): RoutableKey => ({
  provider,
  updatedAt,
  unavailable,
});

describe("resolveRouting", () => {
  it("defaults: no keys, no plan → no scripts, free images and voice", () => {
    expect(resolveRouting([])).toEqual({ llm: undefined, image: "free", tts: "free" });
  });

  it("a Gemini key alone does scripts but not images (images stay free until picked)", () => {
    expect(resolveRouting([key("gemini")])).toEqual({ llm: "gemini", image: "free", tts: "free" });
  });

  it("fal and ElevenLabs keys are used by default for their only job", () => {
    expect(resolveRouting([key("fal"), key("elevenlabs")])).toMatchObject({
      image: "fal",
      tts: "elevenlabs",
    });
  });

  it("an explicit choice wins; an impossible one falls back to the default", () => {
    const keys = [key("gemini"), key("anthropic", "2026-10-19T11:00:00Z")];
    expect(resolveRouting(keys, { llm: "gemini", image: "gemini" })).toMatchObject({
      llm: "gemini",
      image: "gemini",
    });
    expect(resolveRouting(keys, {}).llm).toBe("anthropic"); // newest
    expect(resolveRouting(keys, { llm: "openai", image: "fal" })).toMatchObject({
      llm: "anthropic",
      image: "free",
    });
  });

  it("a key marked unavailable for images is skipped for images but still does scripts", () => {
    const keys = [{ ...key("gemini"), unavailable: [{ capability: "image" as const }] }];
    expect(resolveRouting(keys, { image: "gemini" })).toEqual({ llm: "gemini", image: "free", tts: "free" });
  });

  it("paid plans default to ShortLoop AI where the user has no own key; own keys still win", () => {
    expect(resolveRouting([], {}, { managed: true })).toEqual({
      llm: "shortloop",
      image: "shortloop",
      tts: "shortloop",
    });
    expect(resolveRouting([key("anthropic"), key("fal")], {}, { managed: true })).toEqual({
      llm: "anthropic",
      image: "fal",
      tts: "shortloop",
    });
    expect(resolveRouting([], { image: "free", tts: "free" }, { managed: true })).toMatchObject({
      image: "free",
      tts: "free",
    });
  });

  it("ShortLoop AI is only routed for the jobs it can actually do", () => {
    expect(resolveRouting([], {}, { managed: { image: true } })).toEqual({
      llm: undefined,
      image: "shortloop",
      tts: "free",
    });
    expect(resolveRouting([], { tts: "shortloop" }, { managed: { image: true } }).tts).toBe("free");
  });

  it("ShortLoop AI choices are ignored without a paid plan", () => {
    expect(resolveRouting([], { llm: "shortloop", image: "shortloop_premium", tts: "shortloop" })).toEqual({
      llm: undefined,
      image: "free",
      tts: "free",
    });
    expect(resolveRouting([], { image: "shortloop_premium" }, { managed: true }).image).toBe(
      "shortloop_premium",
    );
  });

  it("rejects unknown routing values and free scripts", () => {
    expect(ProviderRouting.safeParse({ image: "midjourney" }).success).toBe(false);
    expect(ProviderRouting.safeParse({ llm: "free" }).success).toBe(false);
    expect(ProviderRouting.safeParse({ llm: "gemini", image: "fal", tts: "free" }).success).toBe(true);
  });

  it("ApiKeyInfo carries key health with an empty unavailable list by default", () => {
    const info = ApiKeyInfo.parse({ provider: "gemini", last4: "1234", updatedAt: "2026-10-19T10:00:00Z" });
    expect(info.unavailable).toEqual([]);
    expect(
      ApiKeyInfo.safeParse({
        ...info,
        lastError: { kind: "quota", capability: "image", message: "x", at: "2026-10-19T10:00:00Z" },
      }).success,
    ).toBe(true);
    expect(ApiKeyInfo.safeParse({ ...info, lastError: { kind: "nope" } }).success).toBe(false);
  });
});

describe("ShortLoop AI costs and limits", () => {
  it("caps a month at 25% of the plan price", () => {
    expect(MANAGED_LIMITS.creator.monthlyUsd).toBe(7.25);
    expect(MANAGED_LIMITS.pro.monthlyUsd).toBe(19.75);
    expect(MANAGED_LIMITS.creator.shortsPerDay).toBe(5);
    expect(MANAGED_LIMITS.pro.shortsPerDay).toBe(15);
  });

  it("a cheap Short (3 script calls, 6 fal images, 700 chars of ElevenLabs) stays under its per-Short limit", () => {
    const script = 3 * costOf("geminiText", { input: 1500, output: 1000 });
    const images = costOf("falImage", { images: 6 });
    const voice = costOf("elevenlabs", { chars: 700 });
    const total = script + images + voice;
    expect(total).toBeLessThan(MANAGED_LIMITS.creator.perShortUsd);
    expect(total).toBeGreaterThan(0.05);
  });

  it("validates usage rows", () => {
    expect(
      AiUsage.safeParse({
        ownerId: "u",
        capability: "image",
        provider: "fal",
        model: "m",
        units: 1,
        costUsd: 0.006,
      }).success,
    ).toBe(true);
    expect(
      AiUsage.safeParse({
        ownerId: "u",
        capability: "image",
        provider: "fal",
        model: "m",
        units: -1,
        costUsd: 0,
      }).success,
    ).toBe(false);
  });
});

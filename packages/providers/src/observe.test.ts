import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProviderError } from "./errors";
import { ImagePromptRejected, type ImageGen, type ImageRequest } from "./image/image";
import { FakeLLM } from "./llm/fake";
import {
  FallbackImage,
  FallbackTTS,
  InstrumentedImage,
  InstrumentedLLM,
  withRetry,
  type ProviderEvent,
  type UsageRecord,
} from "./observe";
import type { TTS } from "./tts/tts";

const rateLimit = (ms?: number) =>
  new ProviderError({ kind: "rate_limit", provider: "gemini", capability: "image", retryAfterMs: ms });
const quota0 = () =>
  new ProviderError({ kind: "quota", provider: "gemini", capability: "image", noAccess: true });

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "observe-"));
});
const req = (): ImageRequest => ({ prompt: "a red bicycle", aspect: "9:16", outDir: dir });

const stubImage = (provider: string, impl: () => Promise<void>): ImageGen & { calls: number } => {
  const g = {
    provider,
    model: `${provider}-model`,
    calls: 0,
    async generate(r: ImageRequest) {
      g.calls++;
      await impl();
      return { path: join(r.outDir, "x.png"), provider, model: `${provider}-model`, prompt: r.prompt };
    },
  };
  return g;
};

describe("withRetry", () => {
  it("waits the provider's retry delay and succeeds on a later attempt", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const out = await withRetry(
      async () => {
        if (++n < 3) throw rateLimit(12_000);
        return "ok";
      },
      { provider: "gemini", capability: "image", sleep },
    );
    expect(out).toBe("ok");
    expect(sleep.mock.calls).toEqual([[12_000], [12_000]]);
  });

  it("gives up after 3 attempts, and immediately on quota or an over-long delay", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw rateLimit();
        },
        { provider: "gemini", capability: "image", sleep },
      ),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    expect(n).toBe(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);

    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw quota0();
        },
        { provider: "gemini", capability: "image", sleep },
      ),
    ).rejects.toMatchObject({ kind: "quota" });
    expect(n).toBe(1);

    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw rateLimit(120_000);
        },
        { provider: "gemini", capability: "image", sleep },
      ),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    expect(n).toBe(1);
  });
});

describe("InstrumentedImage + FallbackImage", () => {
  it("a free-tier Gemini key: reports the error once, falls back to the free provider, result names the free provider", async () => {
    const events: ProviderEvent[] = [];
    const fallbacks: string[] = [];
    const gemini = stubImage("gemini", async () => {
      throw quota0();
    });
    const free = stubImage("pollinations", async () => {});
    const img = new FallbackImage(
      new InstrumentedImage(gemini, { source: "own", report: (e) => events.push(e) }),
      free,
      (e) => fallbacks.push(`${e.from}->${e.to}`),
    );
    const r = await img.generate(req());
    expect(r.provider).toBe("pollinations");
    expect(gemini.calls).toBe(1); // quota isn't retried
    expect(events).toEqual([expect.objectContaining({ provider: "gemini", ok: false, source: "own" })]);
    expect(events[0]?.error?.noAccess).toBe(true);
    expect(fallbacks).toEqual(["gemini->pollinations"]);
    // A permanent refusal sticks: the next beat goes straight to the free provider.
    await img.generate(req());
    expect(gemini.calls).toBe(1);
    expect(free.calls).toBe(2);
  });

  it("doesn't take a safety-blocked prompt to the free provider, and keeps using the primary for other beats", async () => {
    let n = 0;
    const gemini = stubImage("gemini", async () => {
      if (++n === 1)
        throw new ProviderError({
          kind: "blocked",
          provider: "gemini",
          capability: "image",
          detail: "SAFETY",
        });
    });
    const free = stubImage("pollinations", async () => {});
    const img = new FallbackImage(new InstrumentedImage(gemini, { source: "own" }), free);
    await expect(img.generate(req())).rejects.toMatchObject({ kind: "blocked" });
    expect((await img.generate(req())).provider).toBe("gemini");
    expect(free.calls).toBe(0);
  });

  it("a failure on ShortLoop's own key reads as ShortLoop's problem, not the user's billing", async () => {
    const reported: ProviderEvent[] = [];
    const fal = stubImage("fal", async () => {
      throw new ProviderError({
        kind: "quota",
        provider: "fal",
        capability: "image",
        detail: "Exhausted balance",
      });
    });
    const err = await new InstrumentedImage(fal, { source: "shortloop", report: (e) => reported.push(e) })
      .generate(req())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "unavailable", provider: "shortloop" });
    expect((err as Error).message).toBe(
      "ShortLoop AI images aren't available right now, so the free images were used.",
    );
    expect((err as ProviderError).permanent).toBe(false);
    expect(reported[0]?.error).toMatchObject({ kind: "quota", provider: "fal" }); // ops still see the real cause
  });

  it("doesn't fall back when our own prompt rules reject the prompt", async () => {
    const primary = stubImage("fal", async () => {
      throw new ImagePromptRejected("names a real person");
    });
    const free = stubImage("pollinations", async () => {});
    await expect(new FallbackImage(primary, free).generate(req())).rejects.toBeInstanceOf(
      ImagePromptRejected,
    );
    expect(free.calls).toBe(0);
  });

  it("ShortLoop AI: meters each successful call and is denied by the guard before calling the provider", async () => {
    const usage: UsageRecord[] = [];
    const fal = stubImage("fal", async () => {});
    const state: { denial?: string } = {};
    const managed = new InstrumentedImage(fal, {
      source: "shortloop",
      guard: async () => state.denial,
      meter: async (u) => usage.push(u),
      price: (u) => (u.images ?? 0) * 0.006,
    });
    await managed.generate(req());
    expect(usage).toEqual([
      { capability: "image", provider: "fal", model: "fal-model", units: 1, costUsd: 0.006 },
    ]);

    state.denial = "You've used this month's ShortLoop AI allowance.";
    const err = await managed.generate(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "quota", provider: "shortloop", message: state.denial });
    expect((err as ProviderError).permanent).toBe(true);
    expect(fal.calls).toBe(1);
  });
});

describe("InstrumentedLLM", () => {
  it("estimates tokens for metering and passes the model's own output errors through untouched", async () => {
    const usage: UsageRecord[] = [];
    const llm = new InstrumentedLLM(new FakeLLM(() => '{"a":"b"}'), {
      source: "shortloop",
      meter: async (u) => usage.push(u),
      price: (u) => ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)) / 1e6,
    });
    await llm.json({ system: "s".repeat(400), prompt: "p".repeat(400), schema: z.object({ a: z.string() }) });
    expect(usage[0]).toMatchObject({ capability: "llm", provider: "fake", units: 200 + 3 });

    const bad = new InstrumentedLLM(new FakeLLM(() => "not json"), { source: "own" });
    await expect(bad.json({ system: "", prompt: "", schema: z.object({}) })).rejects.toThrow(/no JSON/);
  });
});

describe("FallbackTTS", () => {
  it("switches to the fallback's default voice and says who actually spoke", async () => {
    const primary: TTS = {
      provider: "elevenlabs",
      voices: () => [{ id: "el1", label: "A", language: "en", provider: "elevenlabs", commercialUse: true }],
      synthesize: async () => {
        throw new ProviderError({ kind: "quota", provider: "elevenlabs", capability: "tts" });
      },
    };
    const seen: string[] = [];
    const edge: TTS = {
      provider: "edge",
      voices: () => [
        { id: "en-US-Ava", label: "Ava", language: "en", provider: "edge", commercialUse: false },
      ],
      synthesize: async (r) => {
        seen.push(r.voiceId);
        return { audioPath: "/tmp/a.mp3", words: [], timing: "provider" };
      },
    };
    const r = await new FallbackTTS(primary, edge).synthesize({ text: "hi", voiceId: "el1", outDir: dir });
    expect(seen).toEqual(["en-US-Ava"]);
    expect(r).toMatchObject({ provider: "edge", voiceId: "en-US-Ava" });
    expect(new FallbackTTS(primary, edge).voices()[0]?.id).toBe("el1");
  });
});

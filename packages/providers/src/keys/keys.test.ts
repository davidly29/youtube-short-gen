import { ProviderError } from "../errors";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeminiImage } from "../image";
import { GeminiLLM } from "../llm";
import {
  keyAad,
  last4,
  platformProvidersFromEnv,
  managedProvidersFromEnv,
  providersFromKeys,
  SecretBox,
  secretBoxFromEnv,
  verifyApiKey,
} from ".";

type Call = { url: string; init?: RequestInit };
const recorder = (respond: (url: string) => Response) => {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url));
  }) as typeof fetch;
  return { f, calls };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SecretBox", () => {
  const box = new SecretBox("a-test-master-key-of-enough-length");
  it("round-trips and never contains the plaintext", () => {
    const sealed = box.seal("AIzaSy-super-secret", keyAad("usr_1", "gemini"));
    expect(sealed).not.toContain("super-secret");
    expect(box.open(sealed, keyAad("usr_1", "gemini"))).toBe("AIzaSy-super-secret");
    expect(box.seal("x".repeat(20), "a")).not.toBe(box.seal("x".repeat(20), "a")); // random IV
  });
  it("refuses another owner, another provider, a tampered blob or another master key", () => {
    const sealed = box.seal("AIzaSy-super-secret", keyAad("usr_1", "gemini"));
    expect(() => box.open(sealed, keyAad("usr_2", "gemini"))).toThrow();
    expect(() => box.open(sealed, keyAad("usr_1", "openai"))).toThrow();
    const parts = sealed.split(".");
    parts[3] = `A${parts[3]?.slice(1)}`;
    expect(() => box.open(parts.join("."), keyAad("usr_1", "gemini"))).toThrow();
    expect(() =>
      new SecretBox("another-master-key-entirely").open(sealed, keyAad("usr_1", "gemini")),
    ).toThrow();
  });
  it("requires SHORTLOOP_SECRETS_KEY in production", () => {
    expect(() => secretBoxFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /SHORTLOOP_SECRETS_KEY/,
    );
    expect(secretBoxFromEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeInstanceOf(SecretBox);
  });
  it("shows only the last four characters", () => expect(last4(" sk-abcdefgh1234 ")).toBe("1234"));
});

describe("GeminiLLM", () => {
  it("sends JSON mode with the key in a header (not the URL) and parses the reply", async () => {
    const { f, calls } = recorder(() =>
      json({ candidates: [{ content: { parts: [{ text: '{"hook":"Hi"}' }] } }] }),
    );
    const out = await new GeminiLLM("AIza-key", "gemini-test", f).json({
      system: "sys",
      prompt: "p",
      schema: z.object({ hook: z.string() }),
    });
    expect(out).toEqual({ hook: "Hi" });
    const call = calls[0];
    expect(call?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(call?.url).not.toContain("AIza-key");
    expect((call?.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-key");
    const body = JSON.parse(String(call?.init?.body)) as {
      generationConfig: { responseMimeType: string };
      systemInstruction: { parts: { text: string }[] };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0]?.text).toContain("sys");
  });
  it("turns a bad-key response into an actionable auth error that keeps Google's message", async () => {
    const { f } = recorder(() => json({ error: { message: "API key not valid" } }, 400));
    const err = await new GeminiLLM("bad", "m", f)
      .json({ system: "", prompt: "", schema: z.object({}) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "auth", provider: "gemini", status: 400, detail: "API key not valid" });
    expect((err as Error).message).toMatch(/Google Gemini rejected your API key/);
  });
});

describe("GeminiImage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "gimg-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));
  it("asks for a 9:16 image and saves the returned bytes with the right extension", async () => {
    const bytes = Buffer.from("fake-jpeg-bytes");
    const { f, calls } = recorder(() =>
      json({
        candidates: [
          {
            content: {
              parts: [
                { text: "here" },
                { inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } },
              ],
            },
          },
        ],
      }),
    );
    const r = await new GeminiImage("k", "img-model", f).generate({
      prompt: "a calm ocean",
      aspect: "9:16",
      outDir: dir,
    });
    expect(r.path.endsWith(".jpg")).toBe(true);
    expect(await readFile(r.path)).toEqual(bytes);
    expect(r).toMatchObject({ provider: "gemini", model: "img-model" });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      generationConfig: { imageConfig: { aspectRatio: string }; responseModalities: string[] };
    };
    expect(body.generationConfig).toMatchObject({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    });
  });
});

describe("verifyApiKey", () => {
  it("accepts a key the provider accepts, rejects 401s, and never puts header keys in URLs", async () => {
    for (const provider of ["anthropic", "openai", "gemini", "elevenlabs", "pexels"] as const) {
      const ok = recorder(() => json({}));
      expect(await verifyApiKey(provider, "secret-key-123", ok.f)).toEqual({ ok: true, verified: true });
      expect(ok.calls[0]?.url).not.toContain("secret-key-123");
      const bad = recorder(() => json({}, 401));
      expect(await verifyApiKey(provider, "secret-key-123", bad.f)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/rejected/),
      });
    }
  });
  it("accepts fal unverified and reports network failures", async () => {
    expect(
      await verifyApiKey("fal", "k", (() => Promise.reject(new Error("x"))) as unknown as typeof fetch),
    ).toEqual({ ok: true, verified: false });
    expect(
      await verifyApiKey("gemini", "k", (() => Promise.reject(new Error("x"))) as unknown as typeof fetch),
    ).toMatchObject({ ok: false });
  });
});

describe("providersFromKeys", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 0, 0, s)).toISOString();
  it("unlocks only what the user has keys for; the newest LLM key wins; Gemini does images only when picked", () => {
    expect(providersFromKeys([])).toEqual({
      stock: [],
      route: { llm: undefined, image: "free", tts: "free" },
    });
    const keys = [
      { provider: "anthropic" as const, key: "a", updatedAt: at(1) },
      { provider: "gemini" as const, key: "g", model: "gem-text", imageModel: "gem-img", updatedAt: at(2) },
      { provider: "pexels" as const, key: "p", updatedAt: at(0) },
    ];
    const set = providersFromKeys(keys);
    expect(set.llm).toMatchObject({ provider: "gemini", model: "gem-text" });
    expect(set.image).toBeUndefined(); // free images until the user picks Gemini for images
    expect(set.route.image).toBe("free");
    expect(set.tts).toBeUndefined();
    expect(set.stock.map((s) => s.provider)).toEqual(["pexels"]);
    expect(providersFromKeys(keys, { routing: { image: "gemini", llm: "anthropic" } })).toMatchObject({
      llm: { provider: "anthropic" },
      image: { provider: "gemini", model: "gem-img" },
    });
    expect(providersFromKeys([{ provider: "elevenlabs", key: "e", updatedAt: at(0) }]).tts?.provider).toBe(
      "elevenlabs",
    );
  });

  it("skips a key marked unavailable for a job, and leaves ShortLoop AI jobs to the caller", () => {
    const gemini = {
      provider: "gemini" as const,
      key: "g",
      updatedAt: at(0),
      unavailable: [{ capability: "image" as const }],
    };
    const set = providersFromKeys([gemini], { routing: { image: "gemini" } });
    expect(set.image).toBeUndefined();
    expect(set.route).toEqual({ llm: "gemini", image: "free", tts: "free" });
    const paid = providersFromKeys([], { managed: true });
    expect(paid.route).toEqual({ llm: "shortloop", image: "shortloop", tts: "shortloop" });
    expect(paid.llm).toBeUndefined();
  });
});

describe("managedProvidersFromEnv", () => {
  it("is off without the kill switch, and offers only the jobs whose keys are set", () => {
    expect(managedProvidersFromEnv({ MANAGED_GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv)).toEqual(
      {},
    );
    const m = managedProvidersFromEnv({
      MANAGED_AI_ENABLED: "1",
      MANAGED_FAL_KEY: "f",
    } as unknown as NodeJS.ProcessEnv);
    expect(m.image?.provider.provider).toBe("fal");
    expect(m.llm).toBeUndefined();
    expect(m.tts).toBeUndefined();
    expect(m.image?.price({ images: 6 })).toBeCloseTo(0.036);
    const all = managedProvidersFromEnv({
      MANAGED_AI_ENABLED: "1",
      MANAGED_GEMINI_API_KEY: "g",
      MANAGED_FAL_KEY: "f",
      MANAGED_ELEVENLABS_API_KEY: "e",
    } as unknown as NodeJS.ProcessEnv);
    expect([
      all.llm?.provider.provider,
      all.premiumImage?.provider.provider,
      all.tts?.provider.provider,
    ]).toEqual(["gemini", "gemini", "elevenlabs"]);
  });
});

describe("platformProvidersFromEnv", () => {
  it("ignores the operator's paid keys unless sharing is switched on", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant",
      PEXELS_API_KEY: "px",
      FAL_KEY: "fal",
    } as unknown as NodeJS.ProcessEnv;
    const p = platformProvidersFromEnv(env);
    expect(p.llm).toBeUndefined();
    expect(p).toMatchObject({ stock: [], sharedKeys: false });
    expect(p.image.provider).toBe("pollinations");
    expect(p.tts.provider).toBe("edge");
    const shared = platformProvidersFromEnv({ ...env, SHORTLOOP_SHARED_KEYS: "1" } as NodeJS.ProcessEnv);
    expect(shared.llm?.provider).toBe("anthropic");
    expect(shared.stock.map((s) => s.provider)).toEqual(["pexels"]);
    expect(shared.image.provider).toBe("fal");
  });
});

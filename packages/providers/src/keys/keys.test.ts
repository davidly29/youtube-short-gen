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
  it("surfaces API errors with Google's message", async () => {
    const { f } = recorder(() => json({ error: { message: "API key not valid" } }, 400));
    await expect(
      new GeminiLLM("bad", "m", f).json({ system: "", prompt: "", schema: z.object({}) }),
    ).rejects.toThrow(/Gemini 400: API key not valid/);
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
  it("unlocks only what the user has keys for; the newest LLM key wins; Gemini covers scripts and images", () => {
    expect(providersFromKeys([])).toEqual({ stock: [] });
    const set = providersFromKeys([
      { provider: "anthropic", key: "a", updatedAt: at(1) },
      { provider: "gemini", key: "g", model: "gem-text", imageModel: "gem-img", updatedAt: at(2) },
      { provider: "pexels", key: "p", updatedAt: at(0) },
    ]);
    expect(set.llm).toMatchObject({ provider: "gemini", model: "gem-text" });
    expect(set.image).toMatchObject({ provider: "gemini", model: "gem-img" });
    expect(set.tts).toBeUndefined();
    expect(set.stock.map((s) => s.provider)).toEqual(["pexels"]);
    expect(providersFromKeys([{ provider: "elevenlabs", key: "e", updatedAt: at(0) }]).tts?.provider).toBe(
      "elevenlabs",
    );
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

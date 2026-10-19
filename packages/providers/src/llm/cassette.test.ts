import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CassetteLLM,
  CassetteMiss,
  findSecrets,
  hashRequest,
  RecordingLLM,
  toCassetteRequest,
  type CassetteFile,
} from "./cassette";
import { FakeLLM } from "./fake";

const Reply = z.object({ answer: z.string() });
const req = { system: "You answer briefly.", prompt: "Topic: bees", schema: Reply, maxTokens: 100 };

const tmp = () => mkdtempSync(join(tmpdir(), "llm-cassette-"));

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network disabled in cassette tests");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("hashRequest", () => {
  it("is stable across key order and ignores generation settings", () => {
    const a = toCassetteRequest("m", req);
    const b = toCassetteRequest("m", { ...req, maxTokens: 999, temperature: 0.2 });
    expect(hashRequest(a)).toBe(hashRequest(b));
    expect(hashRequest({ schema: a.schema, messages: a.messages, system: a.system, model: a.model })).toBe(
      hashRequest(a),
    );
  });

  it("changes when the model, system prompt, message or schema changes", () => {
    const base = hashRequest(toCassetteRequest("m", req));
    expect(hashRequest(toCassetteRequest("m2", req))).not.toBe(base);
    expect(hashRequest(toCassetteRequest("m", { ...req, system: "Different." }))).not.toBe(base);
    expect(hashRequest(toCassetteRequest("m", { ...req, prompt: "Topic: ants" }))).not.toBe(base);
    expect(
      hashRequest(toCassetteRequest("m", { ...req, schema: Reply.extend({ extra: z.number() }) })),
    ).not.toBe(base);
  });
});

describe("RecordingLLM + CassetteLLM", () => {
  it("records each call and replays it without the inner model or network", async () => {
    const dir = tmp();
    const inner = new FakeLLM(() => JSON.stringify({ answer: "they dance" }));
    const rec = new RecordingLLM(inner, dir, () => new Date("2026-10-19T00:00:00Z"));
    expect(await rec.json(req)).toEqual({ answer: "they dance" });

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const file = JSON.parse(readFileSync(join(dir, files[0] as string), "utf8")) as CassetteFile;
    expect(file).toMatchObject({
      model: "fake-1",
      recordedWith: "fake",
      recordedAt: "2026-10-19T00:00:00.000Z",
    });
    expect(file.request.messages).toEqual([{ role: "user", content: "Topic: bees" }]);

    const replay = new CassetteLLM(dir);
    expect(replay.model).toBe("fake-1");
    expect(await replay.json(req)).toEqual({ answer: "they dance" });
  });

  it("throws CassetteMiss with a re-record hint when the prompt changes", async () => {
    const dir = tmp();
    await new RecordingLLM(new FakeLLM(() => '{"answer":"x"}'), dir).json(req);
    const replay = new CassetteLLM(dir);
    const err = await replay.json({ ...req, system: "You answer at length." }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CassetteMiss);
    expect((err as Error).message).toMatch(/pnpm -F pipeline record:script/);
  });

  it("re-validates the recorded response against the schema", async () => {
    const dir = tmp();
    await new RecordingLLM(new FakeLLM(() => '{"answer":"x"}'), dir).json(req);
    const replay = new CassetteLLM(dir);
    // Same JSON Schema shape is required for a hit, so check parse() is applied via a refined schema.
    await expect(replay.json({ ...req, schema: Reply.refine((r) => r.answer.length > 5) })).rejects.toThrow();
  });

  it("refuses to record a reply that looks like it carries a secret", async () => {
    const dir = tmp();
    const rec = new RecordingLLM(new FakeLLM(() => '{"answer":"use sk-live-123"}'), dir);
    await expect(rec.json(req)).rejects.toThrow(/secret patterns/);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("replays a hand-edited cassette re-recorded with a real model, with no code change", async () => {
    const dir = tmp();
    // Hand-written as if the owner re-ran `record:script` with their own key. The hash is pinned here,
    // so a change to the hashing scheme (which would orphan real recordings) fails this test.
    const request = toCassetteRequest("claude-sonnet-5-5", req);
    const handEdited: CassetteFile = {
      requestHash: "e441a857e8de543ca5cdd95d0c7588e19aa6c3a6c1f60628fdd5cb410ee6a049",
      model: "claude-sonnet-5-5",
      recordedWith: "real",
      recordedAt: "2026-10-20T09:00:00.000Z",
      request,
      response: { answer: "Bees waggle-dance to share directions." },
    };
    writeFileSync(join(dir, "real.json"), JSON.stringify(handEdited, null, 2));

    const replay = new CassetteLLM(dir);
    expect(replay.model).toBe("claude-sonnet-5-5");
    expect(await replay.json(req)).toEqual({ answer: "Bees waggle-dance to share directions." });
  });

  it("rejects a directory that mixes models or is empty", () => {
    const dir = tmp();
    expect(() => new CassetteLLM(dir)).toThrow(/no cassettes/);
    const mk = (model: string, name: string) => {
      const request = toCassetteRequest(model, req);
      const f: CassetteFile = {
        requestHash: hashRequest(request),
        model,
        recordedWith: "real",
        recordedAt: "2026-10-20T00:00:00.000Z",
        request,
        response: { answer: "a" },
      };
      writeFileSync(join(dir, name), JSON.stringify(f));
    };
    mk("a", "a.json");
    mk("b", "b.json");
    expect(() => new CassetteLLM(dir)).toThrow(/mix models/);
  });
});

describe("findSecrets", () => {
  it("flags key-looking content and allows ordinary words", () => {
    expect(findSecrets('{"api_key":"x"}')).not.toEqual([]);
    expect(findSecrets("Authorization: Bearer abc")).not.toEqual([]);
    expect(findSecrets("x-api-key: abc")).not.toEqual([]);
    expect(findSecrets('"sk-ant-abc123"')).not.toEqual([]);
    expect(findSecrets("a task-based, risk-free plan")).toEqual([]);
  });
});

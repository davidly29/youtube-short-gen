import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, FakeLLM, llmFromEnv, LLMOutputError, AnthropicLLM, OpenAILLM } from "./index";

describe("extractJson", () => {
  it("handles bare JSON, fenced JSON and chatter around it", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson("Here you go: [1,2,3] hope it helps")).toEqual([1, 2, 3]);
  });
  it("throws LLMOutputError on no or broken JSON", () => {
    expect(() => extractJson("no json here")).toThrow(LLMOutputError);
    expect(() => extractJson("{oops}")).toThrow(LLMOutputError);
  });
});

describe("FakeLLM", () => {
  it("validates replies against the schema", async () => {
    const llm = new FakeLLM((_r, i) => (i === 0 ? '{"n":"x"}' : '{"n":2}'));
    const schema = z.object({ n: z.number() });
    await expect(llm.json({ system: "s", prompt: "p", schema })).rejects.toThrow(LLMOutputError);
    await expect(llm.json({ system: "s", prompt: "p", schema })).resolves.toEqual({ n: 2 });
    expect(llm.calls).toHaveLength(2);
  });
});

describe("llmFromEnv", () => {
  it("prefers Anthropic, falls back to OpenAI, and errors with no key", () => {
    expect(llmFromEnv({ ANTHROPIC_API_KEY: "k" })).toBeInstanceOf(AnthropicLLM);
    expect(llmFromEnv({ OPENAI_API_KEY: "k" })).toBeInstanceOf(OpenAILLM);
    expect(() => llmFromEnv({})).toThrow(/No LLM configured/);
  });
});

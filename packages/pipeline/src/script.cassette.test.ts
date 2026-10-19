import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "@shortloop/contracts";
import { CassetteLLM, CassetteMiss, findSecrets, loadCassettes } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateScript, targetWords } from "./script";
import { SCRIPT_FIXTURE_TOPICS, scriptFixtureRequest } from "./script.fixtures";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../test/cassettes/script");

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network disabled: script cassettes must replay offline");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("script cassettes (recorded LLM replies)", () => {
  const llm = new CassetteLLM(DIR);

  it.each(SCRIPT_FIXTURE_TOPICS)("replays offline and passes the quality checks: %s", async (topic) => {
    const req = scriptFixtureRequest(topic);
    const s = await generateScript(llm, req);
    expect(Script.parse(s)).toBeTruthy();
    expect(s.hook.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(12);
    expect(s.beats.length).toBeGreaterThanOrEqual(4);
    expect(s.beats.length).toBeLessThanOrEqual(8);
    const goal = targetWords(req.targetSeconds);
    expect(Math.abs(s.wordCount - goal)).toBeLessThanOrEqual(goal * 0.1);
    expect(s.beats.every((b) => b.visualQuery.trim().length > 0)).toBe(true);
  });

  it("holds a recording for every fixture topic, all from one model", () => {
    const files = loadCassettes(DIR);
    const prompts = files.flatMap((f) => f.request.messages.map((m) => m.content));
    for (const topic of SCRIPT_FIXTURE_TOPICS) expect(prompts).toContain(`Topic: ${topic}`);
    expect(new Set(files.map((f) => f.model)).size).toBe(1);
  });

  it("contains no keys or auth headers", () => {
    const names = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(names.length).toBeGreaterThanOrEqual(SCRIPT_FIXTURE_TOPICS.length);
    for (const name of names)
      expect([name, findSecrets(readFileSync(join(DIR, name), "utf8"))]).toEqual([name, []]);
  });

  it("throws CassetteMiss with a re-record hint when the system prompt changes", async () => {
    const req = { ...scriptFixtureRequest(SCRIPT_FIXTURE_TOPICS[0]), channelStyle: "dry, deadpan humour" };
    const err = await generateScript(llm, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CassetteMiss);
    expect((err as Error).message).toMatch(/record:script/);
  });
});

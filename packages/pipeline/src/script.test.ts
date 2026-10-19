import { Script } from "@shortloop/contracts";
import { FakeLLM, type JsonRequest } from "@shortloop/providers";
import { describe, expect, it } from "vitest";
import { generateScript, ScriptQualityError, scriptWordCount, targetWords } from "./script";
import { SCRIPT_FIXTURE_TOPICS } from "./script.fixtures";

const TOPICS = SCRIPT_FIXTURE_TOPICS;

/** A well-behaved fake model: writes `words` spoken words across 6 beats, hook first. */
function compliantDraft(topic: string, words: number): string {
  const hook = `Here is something wild about ${topic}.`;
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => ["really", "quite", "simply", "truly"][i % 4]).join(" ");
  const cta = "Follow for more.";
  const remaining = words - hook.split(" ").length - 3;
  const per = Math.floor(remaining / 6);
  const beats = Array.from({ length: 6 }, (_, i) => {
    const n = i === 0 ? per - hook.split(" ").length + per : per + (i === 5 ? remaining - per * 6 : 0);
    return {
      text: i === 0 ? `${hook} ${filler(Math.max(1, per))}.` : `${filler(Math.max(1, n))}.`,
      visualQuery: `${topic} scene ${i + 1}`,
    };
  });
  return JSON.stringify({ title: topic, hook, beats, cta });
}

const target = (req: JsonRequest<unknown>) => Number(/must be (\d+) ±10%/.exec(req.system)?.[1]);

describe("generateScript", () => {
  it.each(TOPICS)("produces a schema-valid script within ±10%% of target length: %s", async (topic) => {
    const llm = new FakeLLM((req) => compliantDraft(topic, target(req)));
    const s = await generateScript(llm, {
      projectId: "prj_1",
      topic,
      targetSeconds: 45,
      tone: "curious",
      language: "en",
    });
    expect(Script.parse(s)).toBeTruthy();
    const goal = targetWords(45);
    expect(Math.abs(s.wordCount - goal)).toBeLessThanOrEqual(goal * 0.1);
    expect(s.beats.every((b) => b.visualQuery.trim().length > 0)).toBe(true);
    expect(s.beats[0]?.text.startsWith(s.hook.replace(/[.!?]$/, ""))).toBe(true);
  });

  it("retries once when the model returns invalid JSON", async () => {
    const llm = new FakeLLM((req, i) =>
      i === 0 ? "sorry, here is your script: {" : compliantDraft("bees", target(req)),
    );
    const s = await generateScript(llm, {
      projectId: "p",
      topic: "bees",
      targetSeconds: 30,
      tone: "fun",
      language: "en",
    });
    expect(s.title).toBe("bees");
    expect(llm.calls).toHaveLength(2);
  });

  it("feeds quality problems back to the model and accepts the corrected draft", async () => {
    const llm = new FakeLLM((req, i) => compliantDraft("ice", i === 0 ? target(req) * 2 : target(req)));
    await generateScript(llm, {
      projectId: "p",
      topic: "ice",
      targetSeconds: 30,
      tone: "fun",
      language: "en",
    });
    expect(llm.calls[1]?.prompt).toMatch(/spoken words; target is/);
  });

  it("gives up with ScriptQualityError after three bad drafts", async () => {
    const llm = new FakeLLM((req) => compliantDraft("ice", target(req) * 3));
    await expect(
      generateScript(llm, { projectId: "p", topic: "ice", targetSeconds: 30, tone: "fun", language: "en" }),
    ).rejects.toBeInstanceOf(ScriptQualityError);
  });

  it("counts beats and the call to action as spoken words", () => {
    expect(scriptWordCount({ beats: [{ text: "one two" }, { text: "three" }], cta: "four five" })).toBe(5);
  });
});

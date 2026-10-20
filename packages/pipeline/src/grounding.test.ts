import { readdirSync, readFileSync } from "node:fs";
import { GroundingSource, Script } from "@shortloop/contracts";
import { FakeLLM } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { citationsBlock, groundScript } from "./grounding";

interface Fixture {
  name: string;
  script: Script;
  sources: GroundingSource[];
  /** Ground truth per beat: is it a factual claim, and which source (if any) supports it. */
  labels: Record<string, { factual: boolean; supportedBy?: string | null }>;
  /** Scripted model replies, one per attempt: the classifier's, and the judge's per beat. */
  replies: { classify: string[]; judge: Record<string, string[]> };
}

const dir = new URL("../test/fixtures/grounding/", import.meta.url);
const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Fixture);

/** Plays the fixture's scripted replies back, attempt by attempt, like a recorded model. */
function scriptedLLM(fx: Fixture) {
  const seen = new Map<string, number>();
  const next = (key: string, replies: string[] | undefined) => {
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    const r = replies?.[Math.min(i, replies.length - 1)];
    if (r === undefined) throw new Error(`fixture ${fx.name} has no reply for ${key}`);
    return r;
  };
  return new FakeLLM((req) => {
    if (req.system.includes("check short video scripts for factual claims"))
      return next("classify", fx.replies.classify);
    const beatId = /beatId: (\S+)/.exec(req.prompt)?.[1] ?? "";
    return next(`judge:${beatId}`, fx.replies.judge[beatId]);
  });
}

const fetchSpy = () => vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("GroundingSource contract", () => {
  it("accepts a source with text and rejects a bad URL or empty text", () => {
    const ok = { url: "https://news.example.org/a", title: "A", text: "Some text." };
    expect(GroundingSource.safeParse(ok).success).toBe(true);
    expect(GroundingSource.safeParse({ ...ok, url: "not a url" }).success).toBe(false);
    expect(GroundingSource.safeParse({ ...ok, text: "" }).success).toBe(false);
  });
  it("every fixture is a valid script with valid sources", () => {
    expect(fixtures).toHaveLength(10);
    for (const fx of fixtures) {
      expect(Script.safeParse(fx.script).success, fx.name).toBe(true);
      for (const s of fx.sources) expect(GroundingSource.safeParse(s).success, fx.name).toBe(true);
    }
  });
});

describe("groundScript (E3-04)", () => {
  it("flags ≥ 90% of unsupported beats and no supported beat across the 10 fixtures", async () => {
    const spy = fetchSpy();
    let unsupportedTotal = 0;
    let unsupportedFlagged = 0;
    const wrongFlags: string[] = [];
    for (const fx of fixtures) {
      const res = await groundScript(fx.script, fx.sources, { llm: scriptedLLM(fx) });
      const flagged = new Set(res.unsupported);
      for (const [beatId, label] of Object.entries(fx.labels)) {
        const isUnsupported = label.factual && !label.supportedBy;
        if (isUnsupported) {
          unsupportedTotal++;
          if (flagged.has(beatId)) unsupportedFlagged++;
        } else if (flagged.has(beatId)) {
          wrongFlags.push(`${fx.name}:${beatId}`);
        }
      }
      // Citations point at the labelled source, and only for supported beats.
      for (const c of res.citations) expect(fx.labels[c.beatId]?.supportedBy, fx.name).toBe(c.url);
      expect(Script.safeParse(res.script).success, fx.name).toBe(true);
    }
    console.info(
      `grounding: flagged ${unsupportedFlagged}/${unsupportedTotal} unsupported beats, ${wrongFlags.length} wrong flags`,
    );
    expect(unsupportedTotal).toBeGreaterThanOrEqual(10);
    expect(unsupportedFlagged / unsupportedTotal).toBeGreaterThanOrEqual(0.9);
    expect(wrongFlags).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("removes [verify] from supported beats only, keeps it on unsupported ones, and fixes the word count", async () => {
    const fx = fixtures.find((f) => f.name === "space-telescope") as Fixture;
    const res = await groundScript(fx.script, fx.sources, { llm: scriptedLLM(fx) });
    const text = (id: string) => res.script.beats.find((b) => b.id === id)?.text;
    expect(text("b2")).not.toContain("[verify]");
    expect(text("b3")).not.toContain("[verify]");
    expect(text("b4")).toContain("[verify]");
    expect(res.unsupported).toEqual(["b4"]);
    expect(res.citations).toEqual([
      { beatId: "b2", url: "https://news.example.org/space/telescope-galaxy" },
      { beatId: "b3", url: "https://news.example.org/space/mirror" },
    ]);
    expect(res.script.wordCount).toBe(fx.script.wordCount - 2);
  });

  it("treats a cited URL that isn't one of the sources as unsupported", async () => {
    const fx = fixtures.find((f) => f.name === "coffee-study") as Fixture;
    const res = await groundScript(fx.script, fx.sources, { llm: scriptedLLM(fx) });
    expect(res.unsupported).toContain("b3");
    expect(res.citations.map((c) => c.url)).not.toContain("https://made-up.example.com/coffee-cure");
  });

  it("retries a malformed classifier reply once, and a judge that fails twice means unsupported", async () => {
    const volcano = fixtures.find((f) => f.name === "wiki-spike-volcano") as Fixture;
    const llm = scriptedLLM(volcano);
    const res = await groundScript(volcano.script, volcano.sources, { llm });
    expect(res.citations.map((c) => c.beatId)).toEqual(["b2"]);
    expect(res.unsupported).toEqual(["b3"]);

    const marathon = fixtures.find((f) => f.name === "marathon-record") as Fixture;
    const res2 = await groundScript(marathon.script, marathon.sources, { llm: scriptedLLM(marathon) });
    expect(res2.unsupported).toEqual(["b3"]);
    expect(res2.script.beats[2]?.text).toContain("[verify]");
  });

  it("with no sources, every checked beat is unsupported and no judge is asked", async () => {
    const fx = fixtures.find((f) => f.name === "no-sources") as Fixture;
    const llm = scriptedLLM(fx);
    const res = await groundScript(fx.script, fx.sources, { llm });
    expect(res.unsupported).toEqual(["b2", "b3"]);
    expect(llm.calls).toHaveLength(1); // the classifier only
    expect(res.script).toEqual(fx.script);
  });

  it("if the classifier fails twice, it still checks the [verify] beats", async () => {
    const fx = fixtures.find((f) => f.name === "ancient-rome-concrete") as Fixture;
    const broken: Fixture = { ...fx, replies: { ...fx.replies, classify: ["nope", "nope"] } };
    const res = await groundScript(fx.script, fx.sources, { llm: scriptedLLM(broken) });
    expect(res.unsupported).toEqual(["b4"]); // the tagged beat; untagged b3 can't be found without a classifier
  });

  it("with no LLM, every [verify] beat is unsupported and the script is unchanged", async () => {
    const spy = fetchSpy();
    for (const fx of fixtures) {
      const res = await groundScript(fx.script, fx.sources);
      const tagged = fx.script.beats.filter((b) => b.text.includes("[verify]")).map((b) => b.id);
      expect(res.unsupported, fx.name).toEqual(tagged);
      expect(res.citations).toEqual([]);
      expect(res.script).toEqual(fx.script);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("citationsBlock", () => {
  it("lists each URL once, in beat order", () => {
    expect(
      citationsBlock([
        { beatId: "b2", url: "https://a.example.com/1" },
        { beatId: "b3", url: "https://b.example.com/2" },
        { beatId: "b5", url: "https://a.example.com/1" },
      ]),
    ).toBe("Sources:\n- https://a.example.com/1\n- https://b.example.com/2");
  });
  it("is empty when there is nothing to cite", () => {
    expect(citationsBlock([])).toBe("");
  });
  it("follows groundScript's beat order end to end", async () => {
    const fx = fixtures.find((f) => f.name === "ai-chip-launch") as Fixture;
    const res = await groundScript(fx.script, fx.sources, { llm: scriptedLLM(fx) });
    expect(res.citations.map((c) => c.beatId)).toEqual(["b2", "b3"]);
    expect(citationsBlock(res.citations)).toBe("Sources:\n- https://tech.example.com/chip-launch");
  });
});

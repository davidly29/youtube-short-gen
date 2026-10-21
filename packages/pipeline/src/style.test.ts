import { MIN_STYLE_VIDEOS, Script, type StyleProfile } from "@shortloop/contracts";
import { FAKE_OWN_VIDEOS, FakeLLM, type JsonRequest } from "@shortloop/providers";
import { describe, expect, it } from "vitest";
import { generateScript } from "./script";
import { SCRIPT_FIXTURE_TOPICS, scriptFixtureRequest } from "./script.fixtures";
import {
  GENERIC_CLICHES,
  judgeStyle,
  NotEnoughVideosError,
  profileFromVideos,
  styleMatch,
  styleNotes,
} from "./style";

const profile = profileFromVideos(FAKE_OWN_VIDEOS);

describe("profileFromVideos (E4-03)", () => {
  it("builds a profile from >= 10 of the creator's own videos", () => {
    expect(FAKE_OWN_VIDEOS.length).toBeGreaterThanOrEqual(MIN_STYLE_VIDEOS);
    expect(profile.vocabulary.slice(0, 6)).toEqual(expect.arrayContaining(["empire", "legion"]));
    expect(profile.hookPatterns).toContain("Why the …");
    expect(profile.hookPatterns).toContain("{n} …");
    expect(profile.sentenceLength).toBeGreaterThan(5);
    expect(profile.sentenceLength).toBeLessThan(12);
    expect(profile.examples[0]).toBe(FAKE_OWN_VIDEOS[0]?.title);
    expect(profile.bannedPhrases).toEqual([...GENERIC_CLICHES]);
  });

  it("refuses with fewer than 10 videos", () => {
    expect(() => profileFromVideos(FAKE_OWN_VIDEOS.slice(0, MIN_STYLE_VIDEOS - 1))).toThrow(
      NotEnoughVideosError,
    );
  });

  it("ignores boilerplate repeated across descriptions, links, hashtags and timestamps", () => {
    const p = profileFromVideos(
      FAKE_OWN_VIDEOS.map((v) => ({
        ...v,
        description: `${v.description}\nhttps://patreon.example/me #history 0:42 chapters`,
      })),
    );
    for (const w of ["pinned", "sources", "patreon", "history", "chapters", "told"])
      expect(p.vocabulary).not.toContain(w);
  });

  it("does not ban a cliché the creator actually uses, and learns from transcripts", () => {
    const vids = FAKE_OWN_VIDEOS.map((v, i) =>
      i < 2
        ? { ...v, transcript: "You won't believe how the centurion marched. The centurion never stopped." }
        : v,
    );
    const p = profileFromVideos(vids);
    expect(p.bannedPhrases).not.toContain("you won't believe");
    expect(p.vocabulary).toContain("centurion");
  });
});

// ---- eval: generateScript with a profile vs without, judged by an LLM judge (20 fixtures) ----

const target = (req: JsonRequest<unknown>) => Number(/must be (\d+) ±10%/.exec(req.system)?.[1]);

/**
 * A fake writer that follows whatever voice instructions it is given (as a real model would) and
 * otherwise writes in a generic register: long sentences, generic words, a generic hook.
 */
function styledDraft(topic: string, req: JsonRequest<unknown>): string {
  {
    const len = Number(/Sentences average about (\d+) words/.exec(req.system)?.[1] ?? 22);
    const vocab = /Favour their words where natural: (.*)\./.exec(req.system)?.[1]?.split(", ");
    const pool = vocab
      ? vocab.flatMap((w) => ["the", w])
      : ["people", "often", "think", "about", "this", "but", "there", "is", "more", "to", "learn"];
    const hook = /open like: "Why the …"/.test(req.system)
      ? `Why the story of ${topic.split(" ").slice(-2).join(" ")} matters.`
      : `Here is the surprising truth about this.`;
    const cta = "Follow for more.";
    const n = target(req) - 3 - hook.split(" ").length;
    const words = Array.from({ length: n }, (_, i) => pool[i % pool.length] ?? "more");
    const per = Math.ceil(n / 5);
    const beats = Array.from({ length: 5 }, (_, b) => {
      const part = words.slice(b * per, (b + 1) * per);
      const sentences: string[] = [];
      for (let i = 0; i < part.length; i += len) {
        const s = part.slice(i, i + len).join(" ");
        sentences.push(s.charAt(0).toUpperCase() + s.slice(1) + ".");
      }
      const text = sentences.join(" ") || "More.";
      return { text: b === 0 ? `${hook} ${text}` : text, visualQuery: `${topic}, scene ${b + 1}` };
    });
    return JSON.stringify({ title: topic, hook, beats, cta });
  }
}
const writer = (topic: string) => new FakeLLM((req) => styledDraft(topic, req));

/** Fake judge: scores with the deterministic reference metric, through the real judge prompt. */
const judge = new FakeLLM((req) => {
  const s = JSON.parse(/Script:\n([\s\S]*)$/.exec(req.prompt)?.[1] ?? "{}") as {
    title: string;
    hook: string;
    beats: string[];
    cta: string;
  };
  const score = Math.round(
    styleMatch(
      {
        title: s.title,
        hook: s.hook,
        cta: s.cta,
        beats: s.beats.map((text) => ({ text })) as Script["beats"],
      },
      profile,
    ) * 10,
  );
  return JSON.stringify({ score, reason: "fake judge" });
});

describe("style-match eval (E4-03)", () => {
  it.each(SCRIPT_FIXTURE_TOPICS)("scores higher with the channel profile than without: %s", async (topic) => {
    const req = scriptFixtureRequest(topic);
    const plainLlm = writer(topic);
    const styledLlm = writer(topic);
    const plain = await generateScript(plainLlm, req);
    const styled = await generateScript(styledLlm, { ...req, styleProfile: profile });

    expect(plainLlm.calls[0]?.system).not.toContain("own voice");
    expect(styledLlm.calls[0]?.system).toContain(styleNotes(profile));

    const a = await judgeStyle(judge, plain, profile);
    const b = await judgeStyle(judge, styled, profile);
    expect(b.score).toBeGreaterThan(a.score);
    expect(Script.parse(styled).wordCount).toBe(styled.wordCount);
  });

  it("the judge prompt carries the profile and the script, never more than the script's own text", async () => {
    const llm = writer("why cats purr");
    const s = await generateScript(llm, { ...scriptFixtureRequest("why cats purr"), styleProfile: profile });
    await judgeStyle(judge, s, profile);
    const call = judge.calls.at(-1);
    expect(call?.prompt).toContain(styleNotes(profile));
    expect(call?.prompt).toContain(s.hook);
  });
});

describe("generateScript with a profile", () => {
  it("rejects a draft that uses a banned phrase and asks for a fix", async () => {
    const p: StyleProfile = { ...profile, bannedPhrases: ["let's dive in"] };
    const llm = new FakeLLM((req, i) => {
      const out = JSON.parse(styledDraft("bees", req)) as { cta: string };
      if (i === 0) out.cta = "Let's dive in, follow!";
      return JSON.stringify(out);
    });
    const s = await generateScript(llm, { ...scriptFixtureRequest("bees"), styleProfile: p });
    expect(s.cta).not.toMatch(/dive in/i);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.prompt).toContain(`never use these phrases: "let's dive in"`);
  });

  it("keeps the 'never imitate another creator' rule", async () => {
    const llm = writer("bees");
    await generateScript(llm, { ...scriptFixtureRequest("bees"), styleProfile: profile });
    expect(llm.calls[0]?.system).toContain("Never imitate any other creator");
  });
});

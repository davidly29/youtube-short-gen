import { readFileSync } from "node:fs";
import {
  Brief,
  DEFAULT_NICHES,
  FormatSlug,
  type Niche,
  type Topic,
  type TrendSignal,
} from "@shortloop/contracts";
import { FakeLLM } from "@shortloop/providers";
import { describe, expect, it, vi } from "vitest";
import { buildBrief, pickTopics, templateItem } from "./brief";
import { clusterTopics } from "./trends/cluster";

const fx = JSON.parse(readFileSync(new URL("../test/fixtures/trends-7d.json", import.meta.url), "utf8")) as {
  now: string;
  signals: TrendSignal[];
};
const history = DEFAULT_NICHES.find((n) => n.id === "history") as Niche;
const topics = clusterTopics(fx.signals, history, { now: new Date(fx.now) });
const DATE = "2026-10-20";

const topic = (i: number, over: Partial<Topic> = {}): Topic => ({
  id: `top_${i}`,
  nicheId: "history",
  label: `Story Number ${["One", "Two", "Three", "Four", "Five", "Six", "Seven"][i] ?? i}`,
  keywords: [`story${i}`, `word${i}`],
  velocity: 100 - i,
  signals24h: 5,
  sources: [{ url: `https://news.example.com/${i}`, title: `Headline ${i}`, source: "wikipedia" }],
  firstSeen: "2026-10-19T08:00:00.000Z",
  ...over,
});

/** Answers every topic it is asked about, like a well-behaved model. */
const goodLLM = () =>
  new FakeLLM((req) => {
    const ids = [...req.prompt.matchAll(/topicId: (\S+)/g)].map((m) => m[1]);
    return JSON.stringify({
      items: ids.map((id) => ({
        topicId: id,
        angle: `A fresh take on ${id}`,
        hook: `What nobody told you about ${id}`,
        format: "myth-vs-fact",
      })),
    });
  });

const valid = (b: Awaited<ReturnType<typeof buildBrief>>) => {
  const parsed = Brief.safeParse({ ...b, id: "brief_1", channelId: "ch_1" });
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
};

describe("buildBrief (E3-03)", () => {
  it("makes 3–5 items from the fixture, each with ≥ 1 source URL and a valid format", async () => {
    const b = await buildBrief({ niche: history, topics, recentTopicIds: [], date: DATE });
    valid(b);
    expect(b.partial).toBe(false);
    expect(b.items.length).toBeGreaterThanOrEqual(3);
    expect(b.items.length).toBeLessThanOrEqual(5);
    for (const item of b.items) {
      expect(item.sources.length).toBeGreaterThanOrEqual(1);
      expect(FormatSlug.options).toContain(item.format);
      expect(item.whyNow).toMatch(/^\d+ signals? in 24 h, [\d.]+× the weekly average$/);
    }
  });

  it("excludes topics covered by a project in the last 14 days", async () => {
    const first = await buildBrief({ niche: history, topics, recentTopicIds: [], date: DATE });
    const covered = first.items[0]?.topicId ?? "";
    const again = await buildBrief({ niche: history, topics, recentTopicIds: [covered], date: DATE });
    expect(again.items.map((i) => i.topicId)).not.toContain(covered);
  });

  it("never lists the same story twice (topics sharing 2+ keywords)", async () => {
    const b = await buildBrief({ niche: history, topics, recentTopicIds: [], date: DATE });
    const kws = b.items.map((i) => new Set(topics.find((t) => t.id === i.topicId)?.keywords));
    for (let i = 0; i < kws.length; i++)
      for (let j = i + 1; j < kws.length; j++)
        expect([...(kws[i] ?? [])].filter((k) => kws[j]?.has(k)).length).toBeLessThan(2);
  });

  it("is marked partial (not padded) when fewer than 3 topics are fresh", async () => {
    const b = await buildBrief({
      niche: history,
      topics: [topic(0), topic(1), topic(2)],
      recentTopicIds: ["top_2"],
      date: DATE,
    });
    valid(b);
    expect(b.partial).toBe(true);
    expect(b.items.map((i) => i.topicId)).toEqual(["top_0", "top_1"]);
    const none = await buildBrief({ niche: history, topics: [], recentTopicIds: [], date: DATE });
    valid(none);
    expect(none).toMatchObject({ items: [], partial: true, generatedWith: "template" });
  });

  it("skips topics without a source URL and keeps at most 5", () => {
    const noUrl = topic(0, { sources: [{ title: "No link", source: "wikipedia" }] });
    const picked = pickTopics([noUrl, ...[1, 2, 3, 4, 5, 6].map((i) => topic(i))], []);
    expect(picked.map((t) => t.id)).toEqual(["top_1", "top_2", "top_3", "top_4", "top_5"]);
  });

  it("uses the owner's LLM when given one (generatedWith 'llm'), without network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const llm = goodLLM();
    const b = await buildBrief({ niche: history, topics, recentTopicIds: [], date: DATE, llm });
    valid(b);
    expect(b.generatedWith).toBe("llm");
    expect(b.items.every((i) => i.format === "myth-vs-fact" && i.angle.startsWith("A fresh take"))).toBe(
      true,
    );
    expect(llm.calls).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("uses the template without a key (generatedWith 'template'), without network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const b = await buildBrief({
      niche: history,
      topics: [topic(0), topic(1), topic(2)],
      recentTopicIds: [],
      date: DATE,
    });
    expect(b.generatedWith).toBe("template");
    expect(b.items[0]).toMatchObject({
      angle: 'Why "Story Number One" is trending',
      hook: "Story Number One: here's what changed this week",
      format: "trend-explainer",
    });
    expect(
      templateItem(topic(0, { sources: [{ url: "https://x.example.com/a", title: "t", source: "rss" }] }))
        .format,
    ).toBe("news-in-60s");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("retries a bad LLM reply once, then falls back to the template", async () => {
    const recovers = new FakeLLM((req, i) =>
      i === 0
        ? "{}"
        : JSON.stringify({
            items: [...req.prompt.matchAll(/topicId: (\S+)/g)].map((m) => ({
              topicId: m[1],
              angle: "Angle",
              hook: "Short hook here",
              format: "top-3-list",
            })),
          }),
    );
    const b = await buildBrief({ niche: history, topics, recentTopicIds: [], date: DATE, llm: recovers });
    expect(recovers.calls).toHaveLength(2);
    expect(b.generatedWith).toBe("llm");

    const broken = new FakeLLM(() => "no json at all");
    const fallback = await buildBrief({
      niche: history,
      topics,
      recentTopicIds: [],
      date: DATE,
      llm: broken,
    });
    expect(broken.calls).toHaveLength(2);
    expect(fallback.generatedWith).toBe("template");
    valid(fallback);
  });

  it("falls back to the template for an LLM line that fails the content policy", async () => {
    const llm = new FakeLLM((req) =>
      JSON.stringify({
        items: [...req.prompt.matchAll(/topicId: (\S+)/g)].map((m) => ({
          topicId: m[1],
          angle: "Buy TSLA now, guaranteed returns by Friday",
          hook: "Go all in on NVDA before earnings",
          format: "trend-explainer",
        })),
      }),
    );
    const b = await buildBrief({
      niche: history,
      topics: [topic(0), topic(1), topic(2)],
      recentTopicIds: [],
      date: DATE,
      llm,
    });
    valid(b);
    expect(b.items[0]?.angle).toBe('Why "Story Number One" is trending');
    expect(b.items.every((i) => !/TSLA|NVDA/.test(`${i.angle} ${i.hook}`))).toBe(true);
  });
});

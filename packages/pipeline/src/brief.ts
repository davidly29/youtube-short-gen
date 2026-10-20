import {
  type Brief,
  type BriefItem,
  type BriefSource,
  FormatSlug,
  type Niche,
  type Topic,
} from "@shortloop/contracts";
import { JSON_ONLY, type LLM } from "@shortloop/providers";
import { z } from "zod";
import { policyCheck } from "./policy";

/** Topics a channel covered in this many days are left out of its brief (E3-03). */
export const BRIEF_EXCLUDE_DAYS = 14;
export const BRIEF_MIN_ITEMS = 3;
export const BRIEF_MAX_ITEMS = 5;
/** Two topics sharing this many keywords are the same story told twice: only the stronger is used. */
const SAME_STORY_SHARED_KEYWORDS = 2;

export interface BuildBriefInput {
  niche: Niche;
  /** Topics from `clusterTopics`, any order. */
  topics: readonly Topic[];
  /** Topic ids of the channel's projects from the last 14 days. */
  recentTopicIds: readonly string[];
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  /** The channel owner's own LLM (BYOK). Without one, a free deterministic template is used. */
  llm?: LLM;
}

export type BuiltBrief = Omit<Brief, "id" | "channelId">;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const LlmBriefItem = z.object({
  topicId: z.string().min(1),
  angle: z.string().min(1).max(200),
  hook: z
    .string()
    .min(1)
    .max(120)
    .refine((s) => words(s) <= 12, "hook must be at most 12 words"),
  format: FormatSlug,
});
const LlmBrief = z.object({ items: z.array(LlmBriefItem).min(1).max(BRIEF_MAX_ITEMS) });

const fmt = (v: number) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));

/** Deterministic, free "why now" line. */
export const whyNow = (t: Topic): string =>
  `${t.signals24h} signal${t.signals24h === 1 ? "" : "s"} in 24 h, ${fmt(t.velocity)}× the weekly average`;

function briefSources(t: Topic): BriefSource[] {
  return t.sources
    .filter((s): s is typeof s & { url: string } => Boolean(s.url))
    .slice(0, 3)
    .map((s) => ({ url: s.url, title: s.title, source: s.source }));
}

/** The free template: angle, hook and format from the topic alone. */
export function templateItem(t: Topic): Omit<BriefItem, "whyNow" | "sources"> {
  return {
    topicId: t.id,
    angle: `Why "${t.label}" is trending`,
    hook: `${t.label}: here's what changed this week`,
    format: t.sources.some((s) => s.source === "rss") ? "news-in-60s" : "trend-explainer",
  };
}

/** Pick 3–5 fresh topics: not covered recently, citable (≥ 1 URL), and not the same story twice. */
export function pickTopics(topics: readonly Topic[], recentTopicIds: readonly string[]): Topic[] {
  const recent = new Set(recentTopicIds);
  const ranked = [...topics].sort((a, b) => b.velocity - a.velocity || a.id.localeCompare(b.id));
  const picked: Topic[] = [];
  for (const t of ranked) {
    if (picked.length >= BRIEF_MAX_ITEMS) break;
    if (recent.has(t.id) || briefSources(t).length === 0) continue;
    const kw = new Set(t.keywords);
    const dup = picked.some(
      (p) => p.keywords.filter((k) => kw.has(k)).length >= Math.min(SAME_STORY_SHARED_KEYWORDS, kw.size),
    );
    if (!dup) picked.push(t);
  }
  return picked;
}

async function llmItems(llm: LLM, niche: Niche, topics: readonly Topic[]) {
  const system = [
    `You plan original YouTube Shorts for a ${niche.name} channel.`,
    "For each topic, propose one fresh angle the creator can make their own, a hook of at most 12 words,",
    `and a format from: ${FormatSlug.options.join(", ")}.`,
    "Do not quote or impersonate real people. Do not state unverified claims as fact.",
    'Return {"items":[{"topicId","angle","hook","format"}]} with one item per topic, same topicId.',
    JSON_ONLY,
  ].join("\n");
  const prompt = topics
    .map(
      (t) => `topicId: ${t.id}\ntopic: ${t.label}\nheadlines: ${t.sources.map((s) => s.title).join(" | ")}`,
    )
    .join("\n\n");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.json({ system, prompt, schema: LlmBrief, maxTokens: 1500, temperature: 0.7 });
      const byId = new Map(out.items.map((i) => [i.topicId, i]));
      if (topics.every((t) => byId.has(t.id))) return byId;
      lastError = new Error("LLM reply missed some topics");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Build a channel's daily brief (E3-03). Pure apart from the injected `llm`: with the owner's key the
 * angles and hooks are written by their LLM (`generatedWith: 'llm'`); without one, or if it fails
 * twice, the free template is used. Fewer than 3 fresh topics gives a `partial` brief, never padding.
 */
export async function buildBrief(input: BuildBriefInput): Promise<BuiltBrief> {
  const topics = pickTopics(input.topics, input.recentTopicIds);
  let generatedWith: BuiltBrief["generatedWith"] = "template";
  let written: Map<string, z.infer<typeof LlmBriefItem>> | undefined;
  if (input.llm && topics.length > 0) {
    try {
      written = await llmItems(input.llm, input.niche, topics);
      generatedWith = "llm";
    } catch (e) {
      console.warn(`brief: LLM failed twice, using the template: ${e instanceof Error ? e.message : e}`);
    }
  }
  const items: BriefItem[] = topics.map((t) => {
    const w = written?.get(t.id);
    // An LLM line that fails the content policy falls back to the template for that topic.
    const usable = w && policyCheck(`${w.angle}\n${w.hook}`).allow;
    const base = usable ? { topicId: t.id, angle: w.angle, hook: w.hook, format: w.format } : templateItem(t);
    return { ...base, whyNow: whyNow(t), sources: briefSources(t) };
  });
  return {
    date: input.date,
    items,
    generatedWith,
    partial: items.length < BRIEF_MIN_ITEMS,
  };
}

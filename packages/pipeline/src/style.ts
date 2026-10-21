import { MIN_STYLE_VIDEOS, StyleProfile, type Script } from "@shortloop/contracts";
import type { LLM } from "@shortloop/providers";
import { z } from "zod";

/** The creator's own text for one video. `transcript` is optional (caption tracks, when we have them). */
export interface StyleSource {
  title: string;
  description: string;
  transcript?: string;
}

export class NotEnoughVideosError extends Error {
  constructor(readonly found: number) {
    super(
      `A channel voice needs at least ${MIN_STYLE_VIDEOS} of your published videos; we found ${found}. Publish a few more, then try again.`,
    );
  }
}

/** Generic AI-script clichés banned by default, unless the creator actually uses them. */
export const GENERIC_CLICHES = [
  "let's dive in",
  "in today's video",
  "without further ado",
  "buckle up",
  "game-changer",
  "delve",
  "smash that like button",
  "you won't believe",
  "in this day and age",
] as const;

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being " +
    "below between both but by can can't could did didn't do does doesn't doing don't down during each few for " +
    "from further get gets got had has have having he her here hers him his how i if in into is isn't it it's " +
    "its just like make made more most much must my no nor not now of off on once one only or other our ours " +
    "out over own same she should so some such than that that's the their theirs them then there these they " +
    "this those through to too under until up us very was wasn't we were what what's when where which while " +
    "who whom why will with won't would you you're your yours video videos channel subscribe watch " +
    "comment comments link links follow today every thing things really still even ever never"
  ).split(/\s+/),
);

const NUMBER_WORDS = new Set(["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
const MAX_DESCRIPTION_CHARS = 600;

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
const wordsOf = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
const norm = (s: string) => s.toLowerCase().replace(/’/g, "'");

/** Strip links, hashtags, handles and timestamps: what's left is how the creator writes. */
function cleanDescription(d: string): string {
  return d
    .slice(0, MAX_DESCRIPTION_CHARS)
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/[#@][\w-]+/g, " ")
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ");
}

function hookPattern(title: string): string | undefined {
  const w = wordsOf(title);
  if (w.length < 3) return undefined;
  const first = norm(w[0] ?? "");
  const isNum = /^\d+$/.test(first) || NUMBER_WORDS.has(first);
  const lead = isNum ? "{n}" : `${w[0]} ${norm(w[1] ?? "")}`;
  const text = lead.charAt(0).toUpperCase() + lead.slice(1);
  return `${text} …${title.trim().endsWith("?") ? "?" : ""}`;
}

/**
 * Learn a channel's voice from the creator's own videos (pure; the worker fetches them). Boilerplate
 * that repeats across most descriptions (sign-offs, "sources in the pinned comment") is ignored.
 */
export function profileFromVideos(videos: StyleSource[]): StyleProfile {
  const usable = videos.filter((v) => v.title.trim());
  if (usable.length < MIN_STYLE_VIDEOS) throw new NotEnoughVideosError(usable.length);

  const sentenceDocs = new Map<string, number>();
  const perVideo = usable.map((v) => {
    const sentences = [...sentencesOf(cleanDescription(v.description)), ...sentencesOf(v.transcript ?? "")];
    for (const s of new Set(sentences.map(norm))) sentenceDocs.set(s, (sentenceDocs.get(s) ?? 0) + 1);
    return { title: v.title.trim(), sentences };
  });
  const boilerplate = (s: string) => (sentenceDocs.get(norm(s)) ?? 0) > usable.length / 2;

  const counts = new Map<string, { n: number; docs: number }>();
  const lengths: number[] = [];
  const corpus: string[] = [];
  for (const v of perVideo) {
    const own = [v.title, ...v.sentences.filter((s) => !boilerplate(s))];
    corpus.push(...own.map(norm));
    for (const s of own) lengths.push(wordsOf(s).length);
    const seen = new Set<string>();
    for (const w of own.flatMap(wordsOf).map(norm)) {
      if (w.length < 4 || STOPWORDS.has(w) || /^\d/.test(w)) continue;
      const c = counts.get(w) ?? { n: 0, docs: 0 };
      c.n += 1;
      if (!seen.has(w)) c.docs += 1;
      seen.add(w);
      counts.set(w, c);
    }
  }
  const vocabulary = [...counts.entries()]
    .filter(([, c]) => c.docs >= 2)
    .sort((a, b) => b[1].n - a[1].n || b[1].docs - a[1].docs || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([w]) => w);

  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const sentenceLength = Math.round(Math.min(40, Math.max(3, avg)) * 10) / 10;

  const patterns = new Map<string, number>();
  for (const v of perVideo) {
    const p = hookPattern(v.title);
    if (p) patterns.set(p, (patterns.get(p) ?? 0) + 1);
  }
  const hookPatterns = [...patterns.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([p]) => p);

  const text = corpus.join("\n");
  const bannedPhrases = GENERIC_CLICHES.filter((c) => !text.includes(c));
  const examples = perVideo.slice(0, 5).map((v) => v.title.slice(0, 200));

  return StyleProfile.parse({ vocabulary, sentenceLength, hookPatterns, bannedPhrases, examples });
}

/** The profile as instructions for the script writer. */
export function styleNotes(p: StyleProfile): string {
  const lines = [`Write in this channel's own voice (learned from the creator's published videos):`];
  lines.push(`- Sentences average about ${Math.round(p.sentenceLength)} words.`);
  if (p.vocabulary.length)
    lines.push(`- Favour their words where natural: ${p.vocabulary.slice(0, 15).join(", ")}.`);
  if (p.hookPatterns.length)
    lines.push(`- Their hooks often open like: ${p.hookPatterns.map((h) => `"${h}"`).join(", ")}.`);
  if (p.examples.length)
    lines.push(
      `- Their own titles, for tone only (don't reuse them): ${p.examples.map((e) => `"${e}"`).join("; ")}.`,
    );
  if (p.bannedPhrases.length) lines.push(`- Never use: ${p.bannedPhrases.map((b) => `"${b}"`).join(", ")}.`);
  return lines.join("\n");
}

/** Banned phrases a text contains (case-insensitive). */
export function bannedPhrasesIn(text: string, banned: readonly string[]): string[] {
  const t = norm(text);
  return banned.filter((b) => b.trim() && t.includes(norm(b.trim())));
}

const scriptText = (s: Pick<Script, "title" | "beats" | "cta">) =>
  [s.title, ...s.beats.map((b) => b.text), s.cta].join("\n");

function matchesPattern(hook: string, pattern: string): boolean {
  const lead = pattern.replace(/\s*…\??$/, "").trim();
  const [first, ...rest] = lead.split(/\s+/);
  const w = wordsOf(hook).map(norm);
  if (!first || w.length <= rest.length) return false;
  const firstOk =
    first === "{n}" ? /^\d+$/.test(w[0] ?? "") || NUMBER_WORDS.has(w[0] ?? "") : w[0] === norm(first);
  return firstOk && rest.every((r, i) => w[i + 1] === norm(r));
}

/**
 * Deterministic style-match score, 0..1: vocabulary use (50%), sentence length (30%) and hook
 * pattern (20%), halved when a banned phrase appears. The LLM judge below is the primary eval;
 * this is its offline reference and a cheap regression check.
 */
export function styleMatch(
  script: Pick<Script, "title" | "hook" | "beats" | "cta">,
  p: StyleProfile,
): number {
  const text = scriptText(script);
  const used = new Set(wordsOf(text).map(norm));
  const vocab = Math.min(1, p.vocabulary.slice(0, 15).filter((w) => used.has(w)).length / 5);
  const sentences = sentencesOf(script.beats.map((b) => b.text).join(" "));
  const avg = sentences.reduce((n, s) => n + wordsOf(s).length, 0) / Math.max(1, sentences.length);
  const length = 1 - Math.min(1, Math.abs(avg - p.sentenceLength) / p.sentenceLength);
  const hook =
    p.hookPatterns.length === 0 || p.hookPatterns.some((h) => matchesPattern(script.hook, h)) ? 1 : 0;
  const score = 0.5 * vocab + 0.3 * length + 0.2 * hook;
  return bannedPhrasesIn(text, p.bannedPhrases).length ? score / 2 : score;
}

export const StyleVerdict = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string().max(500),
});
export type StyleVerdict = z.infer<typeof StyleVerdict>;

/** LLM-as-judge: how well does this script match the channel's voice? 0..10. */
export async function judgeStyle(
  llm: LLM,
  script: Pick<Script, "title" | "hook" | "beats" | "cta">,
  p: StyleProfile,
): Promise<StyleVerdict> {
  return llm.json({
    system: [
      "You judge whether a short-video script sounds like a specific creator.",
      "Score 0-10: 10 = indistinguishable from the creator's own writing, 0 = generic or uses phrases they ban.",
      "Weigh: their vocabulary, their sentence length, their hook style, and any banned phrase (heavy penalty).",
      'Return JSON: {"score": integer 0-10, "reason": string (one sentence)}',
    ].join("\n"),
    prompt: `Creator profile:\n${styleNotes(p)}\n\nScript:\n${JSON.stringify({
      title: script.title,
      hook: script.hook,
      beats: script.beats.map((b) => b.text),
      cta: script.cta,
    })}`,
    schema: StyleVerdict,
    maxTokens: 300,
    temperature: 0,
  });
}

import { randomUUID } from "node:crypto";
import { Script } from "@shortloop/contracts";
import { LLMOutputError, type LLM } from "@shortloop/providers";
import { z } from "zod";

export const WORDS_PER_SECOND = 2.6;

export interface ScriptRequest {
  projectId: string;
  topic: string;
  angle?: string;
  targetSeconds: 30 | 45 | 60;
  tone: string;
  language: string;
  /** Optional channel voice notes (E4-03 builds these from the creator's own videos). */
  channelStyle?: string;
}

/** What we ask the model for. Ids, word counts and durations are computed by us, not trusted from the model. */
const Draft = z.object({
  title: z.string().min(1).max(100),
  hook: z.string().min(1),
  beats: z
    .array(z.object({ text: z.string().min(1), visualQuery: z.string().min(1) }))
    .min(4)
    .max(8),
  cta: z.string(),
});
type Draft = z.infer<typeof Draft>;

export class ScriptQualityError extends Error {
  constructor(readonly problems: string[]) {
    super(`script failed quality checks: ${problems.join("; ")}`);
  }
}

const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;

export function targetWords(seconds: number): number {
  return Math.round(seconds * WORDS_PER_SECOND);
}

export function scriptWordCount(d: { beats: { text: string }[]; cta: string }): number {
  return d.beats.reduce((n, b) => n + countWords(b.text), 0) + countWords(d.cta);
}

/** Quality rules from the ticket: hook ≤ 12 words and first, 4–8 beats, visual per beat, length ±10%. */
export function checkDraft(d: Draft, targetSeconds: number): string[] {
  const problems: string[] = [];
  const target = targetWords(targetSeconds);
  const words = scriptWordCount(d);
  if (countWords(d.hook) > 12) problems.push(`hook has ${countWords(d.hook)} words (max 12)`);
  const first = d.beats[0]?.text.trim().toLowerCase() ?? "";
  if (
    !first.startsWith(
      d.hook
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/, ""),
    )
  )
    problems.push("the first beat must open with the hook");
  if (d.beats.some((b) => !b.visualQuery.trim())) problems.push("every beat needs a visualQuery");
  if (Math.abs(words - target) > target * 0.1)
    problems.push(`script has ${words} spoken words; target is ${target} (±10%) for ${targetSeconds}s`);
  return problems;
}

function systemPrompt(req: ScriptRequest): string {
  return [
    "You write original scripts for vertical short-form videos (YouTube Shorts, TikTok, Reels).",
    "Rules:",
    "- The hook is the very first sentence, at most 12 words, and it is also how beat 1 begins.",
    "- 4 to 8 beats. One idea per beat. Each beat is one or two spoken sentences.",
    "- Every beat has a visualQuery: a concrete, filmable description (subject, action, setting) for stock or AI visuals. No text-on-screen requests, no real people, no brands or characters.",
    "- Present nothing as fact you are unsure of; mark uncertain claims with [verify] at the end of the sentence.",
    "- Never quote named real people. Never imitate a specific creator.",
    `- Total spoken words (beats + cta) must be ${targetWords(req.targetSeconds)} ±10% for a ${req.targetSeconds}-second video at ${WORDS_PER_SECOND} words/second.`,
    `- Language: ${req.language}. Tone: ${req.tone}.`,
    req.channelStyle ? `- Match this channel's voice: ${req.channelStyle}` : "",
    'Return JSON: {"title": string, "hook": string, "beats": [{"text": string, "visualQuery": string}], "cta": string}',
  ]
    .filter(Boolean)
    .join("\n");
}

function userPrompt(req: ScriptRequest, feedback?: string[]): string {
  const parts = [`Topic: ${req.topic}`];
  if (req.angle) parts.push(`Angle: ${req.angle}`);
  if (feedback?.length)
    parts.push(`Your previous draft had these problems, fix all of them:\n- ${feedback.join("\n- ")}`);
  return parts.join("\n");
}

/**
 * Generate an original, hook-first script. Invalid JSON/schema gets one retry; quality problems
 * (length, hook, beats) get up to two corrective retries with the problems fed back.
 */
export async function generateScript(llm: LLM, req: ScriptRequest): Promise<Script> {
  let feedback: string[] | undefined;
  let schemaRetried = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let draft: Draft;
    try {
      draft = await llm.json({
        system: systemPrompt(req),
        prompt: userPrompt(req, feedback),
        schema: Draft,
        maxTokens: 2500,
      });
    } catch (e) {
      if (e instanceof LLMOutputError && !schemaRetried) {
        schemaRetried = true;
        attempt--;
        continue;
      }
      throw e;
    }
    const problems = checkDraft(draft, req.targetSeconds);
    if (problems.length === 0) return toScript(draft, req);
    feedback = problems;
  }
  throw new ScriptQualityError(feedback ?? ["unknown"]);
}

function toScript(d: Draft, req: ScriptRequest): Script {
  return Script.parse({
    id: `scr_${randomUUID()}`,
    projectId: req.projectId,
    title: d.title,
    hook: d.hook,
    beats: d.beats.map((b, i) => ({
      id: `b${i + 1}`,
      text: b.text.trim(),
      visualQuery: b.visualQuery.trim(),
      estDurationMs: Math.round((countWords(b.text) / WORDS_PER_SECOND) * 1000),
    })),
    cta: d.cta.trim(),
    language: req.language,
    wordCount: scriptWordCount(d),
  });
}

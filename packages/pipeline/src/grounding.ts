import { type GroundingSource, Script } from "@shortloop/contracts";
import { JSON_ONLY, type LLM } from "@shortloop/providers";
import { z } from "zod";

/** The tag E4-01 puts after a sentence the model was unsure of. */
const VERIFY_TAG = /\s*\[verify\]/gi;
const hasVerifyTag = (text: string) => /\[verify\]/i.test(text);
const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;
/** Keep prompts bounded: a source's text is RSS-description sized, never a whole page. */
const MAX_SOURCE_CHARS = 1500;

export interface Citation {
  beatId: string;
  url: string;
}

export interface GroundingResult {
  /** The input script with `[verify]` removed from supported beats (still a valid `Script`). */
  script: Script;
  /** One per supported beat, in beat order. */
  citations: Citation[];
  /** Beat ids whose factual claim no source supports, in beat order. They keep their `[verify]` tag. */
  unsupported: string[];
}

export interface GroundingOptions {
  /** The script owner's own LLM (BYOK). Without one, every `[verify]` beat is reported unsupported. */
  llm?: LLM;
}

const Classification = z.object({ factual: z.array(z.string()) });
const Judgement = z.object({
  verdict: z.enum(["supported", "not_supported"]),
  /** The URL of the source that supports the claim (must be one of the given sources). */
  url: z.string().optional(),
});

/** Two attempts: the second covers a malformed or schema-invalid reply. Throws the last error. */
async function twice<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}

async function classifyFactual(llm: LLM, script: Script): Promise<Set<string>> {
  const ids = new Set(script.beats.map((b) => b.id));
  const out = await twice(() =>
    llm.json({
      system: [
        "You check short video scripts for factual claims.",
        "A factual claim states something checkable about the world: a number, date, event, record, study or cause.",
        "Opinions, questions, jokes, calls to action and storytelling are not factual claims.",
        'Return {"factual": [beatId, ...]} listing every beat that contains a factual claim.',
        JSON_ONLY,
      ].join("\n"),
      prompt: script.beats
        .map((b) => `beatId: ${b.id}\ntext: ${b.text.replace(VERIFY_TAG, "")}`)
        .join("\n\n"),
      schema: Classification,
      maxTokens: 400,
      temperature: 0,
    }),
  );
  return new Set(out.factual.filter((id) => ids.has(id)));
}

/** The supporting source URL, or undefined. A URL that isn't one of `sources` counts as unsupported. */
async function judgeBeat(
  llm: LLM,
  text: string,
  beatId: string,
  sources: readonly GroundingSource[],
): Promise<string | undefined> {
  const out = await twice(() =>
    llm.json({
      system: [
        "You fact-check one sentence from a short video script against the sources given, and nothing else.",
        "Answer supported only if a source's text states or directly implies the claim. Your own knowledge does not count.",
        'Return {"verdict": "supported" | "not_supported", "url": the supporting source url when supported}.',
        JSON_ONLY,
      ].join("\n"),
      prompt: [
        `beatId: ${beatId}`,
        `claim: ${text.replace(VERIFY_TAG, "")}`,
        "",
        ...sources.map(
          (s, i) =>
            `source ${i + 1}\nurl: ${s.url}\ntitle: ${s.title}\ntext: ${s.text.slice(0, MAX_SOURCE_CHARS)}`,
        ),
      ].join("\n"),
      schema: Judgement,
      maxTokens: 200,
      temperature: 0,
    }),
  );
  if (out.verdict !== "supported" || !out.url) return undefined;
  return sources.find((s) => s.url === out.url)?.url;
}

/**
 * Fact grounding for news formats (E3-04). Checks beats tagged `[verify]` by E4-01 plus beats the
 * owner's LLM classifies as factual, against text we already hold (no fetching). Supported beats lose
 * their tag and get a citation; unsupported ones keep it and are listed, so the UI can flag them
 * before render. Every failure mode leans towards "unsupported": no LLM, no sources, or a judge that
 * fails twice. If the classifier fails twice, only the `[verify]` beats are checked.
 */
export async function groundScript(
  script: Script,
  sources: readonly GroundingSource[],
  opts: GroundingOptions = {},
): Promise<GroundingResult> {
  const tagged = new Set(script.beats.filter((b) => hasVerifyTag(b.text)).map((b) => b.id));
  const { llm } = opts;
  if (!llm) return { script, citations: [], unsupported: [...tagged] };

  let factual = new Set<string>();
  try {
    factual = await classifyFactual(llm, script);
  } catch (e) {
    console.warn(`grounding: claim classifier failed twice, checking [verify] beats only: ${String(e)}`);
  }
  const citations: Citation[] = [];
  const unsupported: string[] = [];
  const supported = new Set<string>();
  for (const beat of script.beats) {
    if (!tagged.has(beat.id) && !factual.has(beat.id)) continue;
    let url: string | undefined;
    if (sources.length > 0) {
      try {
        url = await judgeBeat(llm, beat.text, beat.id, sources);
      } catch (e) {
        console.warn(`grounding: judge failed twice on ${beat.id}, treating it as unsupported: ${String(e)}`);
      }
    }
    if (url) {
      citations.push({ beatId: beat.id, url });
      supported.add(beat.id);
    } else {
      unsupported.push(beat.id);
    }
  }

  let wordCount = script.wordCount;
  const beats = script.beats.map((b) => {
    if (!supported.has(b.id) || !hasVerifyTag(b.text)) return b;
    const text = b.text.replace(VERIFY_TAG, "").trim();
    if (!text) return b;
    wordCount -= countWords(b.text) - countWords(text);
    return { ...b, text };
  });
  return {
    script: Script.parse({ ...script, beats, wordCount: Math.max(0, wordCount) }),
    citations,
    unsupported,
  };
}

/**
 * A "Sources:" block for a publish description: each URL once, in the order given (groundScript
 * returns citations in beat order). Empty string when there is nothing to cite.
 */
export function citationsBlock(citations: readonly Citation[]): string {
  const urls = [...new Set(citations.map((c) => c.url))];
  return urls.length ? ["Sources:", ...urls.map((u) => `- ${u}`)].join("\n") : "";
}

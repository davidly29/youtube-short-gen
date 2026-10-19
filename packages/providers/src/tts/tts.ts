export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SynthesizeRequest {
  text: string;
  voiceId: string;
  /** 1 = normal speed. */
  speed?: number;
  /** Where to write the audio file (format decided by the provider; read the returned path). */
  outDir: string;
}

export interface SynthesizeResult {
  audioPath: string;
  words: TimedWord[];
  /** "provider" when the provider returned alignment, "estimated" when we spread words over the duration. */
  timing: "provider" | "estimated";
  /** Who actually spoke it, when a wrapper may have fallen back to another provider (ADR 0007). */
  provider?: string;
  /** The voice actually used, when it differs from the requested one (fallback). */
  voiceId?: string;
}

export interface Voice {
  id: string;
  label: string;
  language: string;
  provider: string;
  /** Whether the provider's terms allow commercial use of output from this voice. */
  commercialUse: boolean;
}

export interface TTS {
  readonly provider: string;
  voices(): Voice[];
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>;
}

const WORD = /\S+/g;

/** Spread words across a duration in proportion to their length, with pauses after punctuation. */
export function estimateWordTimings(text: string, totalMs: number): TimedWord[] {
  const words = text.match(WORD) ?? [];
  if (words.length === 0) return [];
  const weight = (w: string) => w.length + 2 + (/[.!?]$/.test(w) ? 3 : /[,;:]$/.test(w) ? 1.5 : 0);
  const total = words.reduce((s, w) => s + weight(w), 0);
  let t = 0;
  return words.map((w) => {
    const dur = (weight(w) / total) * totalMs;
    const word = { text: w, startMs: Math.round(t), endMs: Math.round(t + dur * 0.9) };
    t += dur;
    return word;
  });
}

/** Re-attach punctuation from the source text when a provider returns bare words. */
export function attachPunctuation(text: string, words: TimedWord[]): TimedWord[] {
  const tokens = text.match(WORD) ?? [];
  if (tokens.length !== words.length) return words;
  return words.map((w, i) => ({ ...w, text: tokens[i] ?? w.text }));
}

/** Timings must start at >= 0, never go backwards, and have end > start. */
export function isMonotonic(words: TimedWord[]): boolean {
  return words.every(
    (w, i) => w.endMs > w.startMs && w.startMs >= 0 && (i === 0 || w.startMs >= (words[i - 1]?.startMs ?? 0)),
  );
}

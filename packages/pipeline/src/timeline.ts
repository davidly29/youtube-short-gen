import {
  MAX_SHORT_DURATION_MS,
  Timeline,
  type CaptionStyleId,
  type CaptionWord,
  type Clip,
  type Script,
} from "@shortloop/contracts";

export const TAIL_MS = 300;
export const MUSIC_DUCK_DB = -12;

export interface AssembleInput {
  timelineId: string;
  script: Pick<Script, "beats">;
  voice: { assetId: string; durationMs: number; words: CaptionWord[] };
  clips: Clip[];
  music?: { assetId: string };
  captionStyle: CaptionStyleId;
}

/** Numbers, ALL-CAPS words and *starred* words get the accent colour. */
export function markEmphasis(words: CaptionWord[]): CaptionWord[] {
  return words.map((w) => {
    const bare = w.text.replace(/[^\p{L}\p{N}*]/gu, "");
    const starred = /^\*.+\*$/.test(bare);
    const emphasis =
      starred || /\d/.test(bare) || (bare.length > 1 && bare === bare.toUpperCase() && /\p{L}/u.test(bare));
    return { ...w, text: starred ? w.text.replace(/\*/g, "") : w.text, emphasis };
  });
}

/**
 * Pure: script + voice + clips (+ optional music) -> a valid Timeline.
 * Duration = voice + 300 ms tail (capped at 180 s); the last clip is stretched to the end;
 * music sits 12 dB under the narration for the whole Short.
 */
export function assembleTimeline(input: AssembleInput): Timeline {
  const durationMs = Math.min(MAX_SHORT_DURATION_MS, Math.round(input.voice.durationMs) + TAIL_MS);
  const clips = [...input.clips]
    .sort((a, b) => a.startMs - b.startMs)
    .filter((c) => c.startMs < durationMs)
    .map((c) => ({ ...c, endMs: Math.min(c.endMs, durationMs) }));
  const last = clips[clips.length - 1];
  if (last) last.endMs = durationMs;
  const audio = [
    {
      assetId: input.voice.assetId,
      startMs: 0,
      endMs: Math.min(Math.round(input.voice.durationMs), durationMs),
      gainDb: 0,
    },
    ...(input.music
      ? [{ assetId: input.music.assetId, startMs: 0, endMs: durationMs, gainDb: MUSIC_DUCK_DB }]
      : []),
  ];
  const captions = markEmphasis(input.voice.words)
    .filter((w) => w.startMs < durationMs)
    .map((w) => ({ ...w, endMs: Math.min(w.endMs, durationMs) }))
    .filter((w) => w.endMs > w.startMs);
  return Timeline.parse({
    id: input.timelineId,
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs,
    video: clips,
    audio,
    captions,
    captionStyle: input.captionStyle,
  });
}

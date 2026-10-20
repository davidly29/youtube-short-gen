import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { httpError } from "../errors";
import type { SynthesizeRequest, SynthesizeResult, TTS, TimedWord, Voice } from "./tts";

const VOICES: [string, string][] = [
  ["JBFqnCBsd6RMkjVDRZzb", "George (warm narrator)"],
  ["EXAVITQu4vr4xnSDxMaL", "Sarah (soft, clear)"],
  ["TX3LPaxmHKxFdv7VOQHJ", "Liam (energetic)"],
];

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Turn ElevenLabs character alignment into word timings. */
export function wordsFromAlignment(a: Alignment): TimedWord[] {
  const words: TimedWord[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push({ text: cur, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
      cur = "";
      return;
    }
    if (!cur) start = a.character_start_times_seconds[i] ?? end;
    cur += ch;
    end = a.character_end_times_seconds[i] ?? end;
  });
  if (cur) words.push({ text: cur, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  return words;
}

/** ElevenLabs: paid plans include commercial rights. */
export class ElevenLabsTTS implements TTS {
  readonly provider = "elevenlabs";

  constructor(
    private readonly apiKey: string,
    private readonly modelId = "eleven_multilingual_v2",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  voices(): Voice[] {
    return VOICES.map(([id, label]) => ({
      id,
      label,
      language: "multi",
      provider: this.provider,
      commercialUse: true,
    }));
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const res = await this.fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${req.voiceId}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text: req.text,
          model_id: this.modelId,
          voice_settings: { speed: req.speed ?? 1 },
        }),
      },
    );
    if (!res.ok) throw await httpError("elevenlabs", "tts", res);
    const data = (await res.json()) as { audio_base64: string; alignment: Alignment };
    const audioPath = join(req.outDir, `${randomUUID()}.mp3`);
    await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));
    return { audioPath, words: wordsFromAlignment(data.alignment), timing: "provider" };
  }
}

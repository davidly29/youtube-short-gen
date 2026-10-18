import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionWord } from "@shortloop/contracts";
import { type Db, eq, schema } from "@shortloop/db";
import type { JobHandler } from "@shortloop/pipeline";
import { normaliseLoudness, probeDurationMs, type Storage, type TTS } from "@shortloop/providers";

export interface VoiceInput {
  scriptId: string;
  voiceId: string;
  speed?: number;
}

/** The narration is every beat in order, then the call to action. */
export function narrationText(script: { beats: { text: string }[]; cta: string }): string {
  return [...script.beats.map((b) => b.text), script.cta].filter(Boolean).join(" ");
}

/** Script -> TTS -> loudness-normalised (−14 LUFS) MP3 in storage + audio Asset + word timings. */
export function voiceHandler(db: Db, tts: TTS, storage: Storage): JobHandler {
  return async ({ job, ownerId, onProgress }) => {
    const input = job.input as unknown as VoiceInput;
    const script = await db.query.scripts.findFirst({ where: eq(schema.scripts.id, input.scriptId) });
    if (!script) throw new Error(`unknown script ${input.scriptId}`);
    const dir = await mkdtemp(join(tmpdir(), "voice-"));
    try {
      const text = narrationText(script);
      const r = await tts.synthesize({ text, voiceId: input.voiceId, speed: input.speed, outDir: dir });
      await onProgress(0.6);
      const normalised = join(dir, "voice.mp3");
      await normaliseLoudness(r.audioPath, normalised);
      const durationMs = await probeDurationMs(normalised);
      const id = `aud_${randomUUID()}`;
      const storageKey = `assets/${ownerId}/${id}.mp3`;
      await storage.putFile(storageKey, normalised, "audio/mpeg");
      await db.insert(schema.assets).values({
        id,
        ownerId,
        kind: "audio",
        source: "ai_generated",
        licence: { type: "ai_generated", provider: tts.provider, model: input.voiceId },
        storageKey,
        durationMs,
      });
      const words: CaptionWord[] = r.words.map((w) => ({ ...w, emphasis: false }));
      return { audioAssetId: id, durationMs, words, timing: r.timing };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

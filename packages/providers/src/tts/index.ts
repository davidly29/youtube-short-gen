import { EdgeTTS } from "./edge";
import { ElevenLabsTTS } from "./elevenlabs";
import { FakeTTS } from "./fake";
import type { TTS } from "./tts";

export * from "./tts";
export { EdgeTTS } from "./edge";
export { ElevenLabsTTS, wordsFromAlignment } from "./elevenlabs";
export { FakeTTS } from "./fake";

/** TTS_PROVIDER=elevenlabs|edge|fake. Default: ElevenLabs when a key is set, else Edge. */
export function ttsFromEnv(env: NodeJS.ProcessEnv = process.env): TTS {
  const p = env.TTS_PROVIDER ?? (env.ELEVENLABS_API_KEY ? "elevenlabs" : "edge");
  if (p === "elevenlabs") {
    if (!env.ELEVENLABS_API_KEY) throw new Error("TTS_PROVIDER=elevenlabs needs ELEVENLABS_API_KEY");
    return new ElevenLabsTTS(env.ELEVENLABS_API_KEY);
  }
  if (p === "fake") return new FakeTTS();
  return new EdgeTTS();
}

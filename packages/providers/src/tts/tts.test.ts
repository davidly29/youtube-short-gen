import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureLufs, normaliseLoudness } from "../media/ffmpeg";
import {
  attachPunctuation,
  EdgeTTS,
  ElevenLabsTTS,
  estimateWordTimings,
  FakeTTS,
  isMonotonic,
  ttsFromEnv,
  wordsFromAlignment,
} from "./index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("word timings", () => {
  it("estimates monotonic timings that fit the duration", () => {
    const w = estimateWordTimings("Why does an octopus need three hearts? Let's find out.", 4000);
    expect(w).toHaveLength(10);
    expect(isMonotonic(w)).toBe(true);
    expect(w.at(-1)?.endMs).toBeLessThanOrEqual(4000);
  });

  it("re-attaches punctuation when word counts match", () => {
    const w = attachPunctuation("Hi, there!", [
      { text: "Hi", startMs: 0, endMs: 100 },
      { text: "there", startMs: 150, endMs: 300 },
    ]);
    expect(w.map((x) => x.text)).toEqual(["Hi,", "there!"]);
  });

  it("converts ElevenLabs character alignment to words", () => {
    const chars = "Hi you".split("");
    const w = wordsFromAlignment({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08),
    });
    expect(w).toEqual([
      { text: "Hi", startMs: 0, endMs: 180 },
      { text: "you", startMs: 300, endMs: 580 },
    ]);
  });
});

describe("providers", () => {
  it("FakeTTS writes audio and monotonic timings", async () => {
    const r = await new FakeTTS().synthesize({
      text: "One two three four five.",
      voiceId: "fake-voice",
      outDir: dir,
    });
    expect(isMonotonic(r.words)).toBe(true);
    expect(r.words).toHaveLength(5);
  });

  it("ElevenLabs posts to with-timestamps and decodes audio + alignment", async () => {
    let called = "";
    const fakeFetch = (async (url: string) => {
      called = url;
      return new Response(
        JSON.stringify({
          audio_base64: Buffer.from("ID3").toString("base64"),
          alignment: {
            characters: ["O", "k"],
            character_start_times_seconds: [0, 0.1],
            character_end_times_seconds: [0.1, 0.2],
          },
        }),
      );
    }) as typeof fetch;
    const r = await new ElevenLabsTTS("key", "m", fakeFetch).synthesize({
      text: "Ok",
      voiceId: "v1",
      outDir: dir,
    });
    expect(called).toContain("/v1/text-to-speech/v1/with-timestamps");
    expect(r.words).toEqual([{ text: "Ok", startMs: 0, endMs: 200 }]);
    expect(r.timing).toBe("provider");
  });

  it("Edge voices are flagged as not cleared for commercial use; ElevenLabs voices are", () => {
    expect(new EdgeTTS().voices().every((v) => !v.commercialUse)).toBe(true);
    expect(new ElevenLabsTTS("k").voices().every((v) => v.commercialUse)).toBe(true);
  });

  it("ttsFromEnv picks ElevenLabs with a key, Edge otherwise", () => {
    expect(ttsFromEnv({ ELEVENLABS_API_KEY: "k" })).toBeInstanceOf(ElevenLabsTTS);
    expect(ttsFromEnv({})).toBeInstanceOf(EdgeTTS);
    expect(ttsFromEnv({ TTS_PROVIDER: "fake" })).toBeInstanceOf(FakeTTS);
  });
});

describe("loudness", () => {
  it("normalises narration to −14 ±1 LUFS", async () => {
    const r = await new FakeTTS().synthesize({
      text: "This sentence is long enough to measure loudness properly over several seconds of audio.",
      voiceId: "fake-voice",
      outDir: dir,
    });
    const out = join(dir, "norm.mp3");
    await normaliseLoudness(r.audioPath, out);
    const lufs = await measureLufs(out);
    expect(Math.abs(lufs - -14)).toBeLessThanOrEqual(1);
  });
});

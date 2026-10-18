import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runFfmpeg } from "../media/ffmpeg";
import {
  estimateWordTimings,
  type SynthesizeRequest,
  type SynthesizeResult,
  type TTS,
  type Voice,
} from "./tts";

/** Offline TTS for tests: a quiet tone lasting ~2.6 words/s, with estimated timings. */
export class FakeTTS implements TTS {
  readonly provider = "fake";

  voices(): Voice[] {
    return [
      { id: "fake-voice", label: "Fake voice", language: "en", provider: this.provider, commercialUse: true },
    ];
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const words = req.text.match(/\S+/g)?.length ?? 1;
    const ms = Math.max(800, Math.round((words / (2.6 * (req.speed ?? 1))) * 1000));
    const audioPath = join(req.outDir, `${randomUUID()}.mp3`);
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=220:duration=${(ms / 1000).toFixed(3)}:sample_rate=48000`,
      "-af",
      "volume=-20dB",
      "-c:a",
      "libmp3lame",
      audioPath,
    ]);
    return { audioPath, words: estimateWordTimings(req.text, ms), timing: "estimated" };
  }
}

import { readFile } from "node:fs/promises";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  attachPunctuation,
  estimateWordTimings,
  type SynthesizeRequest,
  type SynthesizeResult,
  type TTS,
  type TimedWord,
  type Voice,
} from "./tts";
import { probeDurationMs } from "../media/ffmpeg";

const VOICES: [string, string, string][] = [
  ["en-US-AndrewMultilingualNeural", "Andrew (US, warm)", "en-US"],
  ["en-US-EmmaMultilingualNeural", "Emma (US, bright)", "en-US"],
  ["en-US-BrianMultilingualNeural", "Brian (US, casual)", "en-US"],
  ["en-US-AvaMultilingualNeural", "Ava (US, expressive)", "en-US"],
  ["en-GB-RyanNeural", "Ryan (UK)", "en-GB"],
  ["en-GB-SoniaNeural", "Sonia (UK)", "en-GB"],
  ["en-IE-ConnorNeural", "Connor (Irish)", "en-IE"],
  ["en-IE-EmilyNeural", "Emily (Irish)", "en-IE"],
];

interface EdgeMetadata {
  Metadata?: { Type: string; Data: { Offset: number; Duration: number; text: { Text: string } } }[];
}

/**
 * Free Microsoft Edge "Read Aloud" voices. Good for development and demos; the service has no
 * published commercial-use licence, so these voices are flagged commercialUse: false.
 */
export class EdgeTTS implements TTS {
  readonly provider = "edge";

  voices(): Voice[] {
    return VOICES.map(([id, label, language]) => ({
      id,
      label,
      language,
      provider: this.provider,
      commercialUse: false,
    }));
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(req.voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });
    const rate = req.speed && req.speed !== 1 ? req.speed : undefined;
    const { audioFilePath, metadataFilePath } = await tts.toFile(
      req.outDir,
      req.text,
      rate ? { rate } : undefined,
    );
    tts.close();
    let words: TimedWord[] = [];
    if (metadataFilePath) {
      const meta = JSON.parse(await readFile(metadataFilePath, "utf8")) as EdgeMetadata;
      words = (meta.Metadata ?? [])
        .filter((m) => m.Type === "WordBoundary")
        .map((m) => ({
          text: m.Data.text.Text,
          startMs: Math.round(m.Data.Offset / 10_000),
          endMs: Math.round((m.Data.Offset + m.Data.Duration) / 10_000),
        }));
    }
    if (words.length === 0) {
      return {
        audioPath: audioFilePath,
        words: estimateWordTimings(req.text, await probeDurationMs(audioFilePath)),
        timing: "estimated",
      };
    }
    return { audioPath: audioFilePath, words: attachPunctuation(req.text, words), timing: "provider" };
  }
}

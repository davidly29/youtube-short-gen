import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Asset } from "@shortloop/contracts";
import { probeDurationMs, runFfmpeg } from "../media/ffmpeg";
import {
  FingerprintUnavailable,
  mergeMatches,
  type Fingerprinter,
  type FingerprintResult,
  type MusicMatch,
} from "./fingerprint";

/** Cuts an audio file into short samples for recognition. Injectable so tests don't need FFmpeg. */
export type AudioSampler = (filePath: string, durationMs?: number) => Promise<Buffer[]>;

const SAMPLE_MS = 12_000;
const MAX_SAMPLES = 6;
/** Longer than any Short (180 s), so a whole track that could play is covered. */
const MAX_SCAN_MS = 180_000;

/** Sample start offsets spread evenly over the first 180 s: one per 30 s, at most six. */
export function sampleOffsets(durationMs: number): number[] {
  const scan = Math.min(Math.max(durationMs, 0), MAX_SCAN_MS);
  if (scan <= SAMPLE_MS) return [0];
  const n = Math.min(MAX_SAMPLES, Math.ceil(scan / 30_000));
  const step = (scan - SAMPLE_MS) / Math.max(n - 1, 1);
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

/** Default sampler: 12 s mono 16 kHz WAV clips at the offsets above (a few hundred KB each). */
export const ffmpegSampler: AudioSampler = async (filePath, durationMs) => {
  const dur = durationMs ?? (await probeDurationMs(filePath));
  const dir = await mkdtemp(join(tmpdir(), "fp-"));
  try {
    const out: Buffer[] = [];
    for (const [i, off] of sampleOffsets(dur).entries()) {
      const p = join(dir, `s${i}.wav`);
      await runFfmpeg(
        ["-ss", String(off / 1000), "-t", String(SAMPLE_MS / 1000), "-i", filePath].concat([
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          p,
        ]),
      );
      out.push(await readFile(p));
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

interface AcrResponse {
  status?: { code?: number; msg?: string };
  metadata?: {
    music?: { title?: string; label?: string; score?: number | string; artists?: { name?: string }[] }[];
  };
}

/** ACRCloud's "no result" code: the sample contains no known recording. */
const NO_RESULT = 1001;

/**
 * ACRCloud identification (https://docs.acrcloud.com/reference/identification-api). Each sample is one signed
 * `POST /v1/identify`; `score` (0–100) becomes the 0..1 confidence. Keys are the operator's own (platform safety
 * check, not BYOK): ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET.
 */
export class AcrCloudFingerprint implements Fingerprinter {
  readonly provider = "acrcloud";

  constructor(
    private readonly host: string,
    private readonly accessKey: string,
    private readonly accessSecret: string,
    private readonly opts: { fetch?: typeof fetch; sampler?: AudioSampler; now?: () => Date } = {},
  ) {}

  async fingerprint(audioAsset: Asset, filePath: string): Promise<FingerprintResult> {
    const samples = await (this.opts.sampler ?? ffmpegSampler)(filePath, audioAsset.durationMs);
    const found: MusicMatch[][] = [];
    for (const s of samples) found.push(await this.identify(s));
    return { provider: this.provider, matches: mergeMatches(found) };
  }

  /** Signature per ACRCloud: HMAC-SHA1 over method, path, key, data type, version and timestamp. */
  signature(timestamp: string): string {
    const toSign = ["POST", "/v1/identify", this.accessKey, "audio", "1", timestamp].join("\n");
    return createHmac("sha1", this.accessSecret).update(toSign).digest("base64");
  }

  private async identify(sample: Buffer): Promise<MusicMatch[]> {
    const timestamp = String(Math.floor((this.opts.now?.() ?? new Date()).getTime() / 1000));
    const form = new FormData();
    form.set("sample", new Blob([new Uint8Array(sample)]), "sample.wav");
    form.set("sample_bytes", String(sample.length));
    form.set("access_key", this.accessKey);
    form.set("data_type", "audio");
    form.set("signature_version", "1");
    form.set("signature", this.signature(timestamp));
    form.set("timestamp", timestamp);
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`https://${this.host}/v1/identify`, { method: "POST", body: form });
    } catch (e) {
      throw new FingerprintUnavailable(this.provider, e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) throw new FingerprintUnavailable(this.provider, `HTTP ${res.status}`);
    const body = (await res.json()) as AcrResponse;
    const code = body.status?.code;
    if (code === NO_RESULT) return [];
    if (code !== 0)
      throw new FingerprintUnavailable(this.provider, `${code ?? "?"} ${body.status?.msg ?? ""}`.trim());
    return (body.metadata?.music ?? []).map((m) => ({
      title: m.title?.trim() || "Unknown title",
      owner:
        m.label?.trim() ||
        (m.artists ?? [])
          .map((a) => a.name)
          .filter(Boolean)
          .join(", ") ||
        "Unknown rights owner",
      confidence: Math.min(1, Math.max(0, Number(m.score ?? 0) / 100)),
    }));
  }
}

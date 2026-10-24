import type { Asset } from "@shortloop/contracts";

/** One recording an audio-recognition service found in an asset. `confidence` is 0..1. */
export interface MusicMatch {
  title: string;
  /** Rights owner as the service reports it: label, else the artists. */
  owner: string;
  confidence: number;
}

export interface FingerprintResult {
  provider: string;
  matches: MusicMatch[];
}

/** Audio recognition behind an interface (E13-03): ACRCloud in production, a fake for tests and demos. */
export interface Fingerprinter {
  readonly provider: string;
  /** Identify commercial recordings in an audio asset whose bytes are at `filePath`. */
  fingerprint(audioAsset: Asset, filePath: string): Promise<FingerprintResult>;
}

/** A match above this confidence blocks publishing. */
export const MUSIC_MATCH_THRESHOLD = 0.8;

/**
 * Which audio needs checking: anything a user brought in themselves. AI voices, licensed stock and the in-app
 * music library are clean by construction. Video clips are rendered muted, so only audio assets can carry music.
 */
export function needsFingerprint(asset: Pick<Asset, "kind" | "source">): boolean {
  return asset.kind === "audio" && (asset.source === "upload" || asset.source === "own_channel");
}

export interface MusicCheck {
  ok: boolean;
  /** One user-readable line per blocking match. */
  problems: string[];
  /** Every match above the threshold, with the asset it was found in (blocking or not). */
  matches: (MusicMatch & { assetId: string; blocking: boolean })[];
}

/**
 * A match above the threshold blocks publishing unless the asset comes from ShortLoop's own music library
 * (`library_music`), which we licence for this use.
 */
export function musicCheck(
  results: { asset: Pick<Asset, "id" | "source" | "title">; result: FingerprintResult }[],
  threshold = MUSIC_MATCH_THRESHOLD,
): MusicCheck {
  const problems: string[] = [];
  const matches: MusicCheck["matches"] = [];
  for (const { asset, result } of results) {
    for (const m of result.matches) {
      if (!(m.confidence > threshold)) continue;
      const blocking = asset.source !== "library_music";
      matches.push({ ...m, assetId: asset.id, blocking });
      if (blocking)
        problems.push(
          `${asset.title ? `"${asset.title}"` : `Audio ${asset.id}`} contains "${m.title}" by ${m.owner} ` +
            `(${Math.round(m.confidence * 100)}% match). Remove it or use a track from the music library.`,
        );
    }
  }
  return { ok: problems.length === 0, problems, matches };
}

/** Merge matches from several samples of one file: one entry per recording, highest confidence kept. */
export function mergeMatches(samples: MusicMatch[][]): MusicMatch[] {
  const best = new Map<string, MusicMatch>();
  for (const m of samples.flat()) {
    const key = `${m.title.toLowerCase()}\u0000${m.owner.toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || m.confidence > prev.confidence) best.set(key, m);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

export class FingerprintUnavailable extends Error {
  constructor(
    readonly provider: string,
    detail: string,
  ) {
    super(`music check (${provider}) is unavailable: ${detail}`);
  }
}

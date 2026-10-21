import type { Asset } from "@shortloop/contracts";
import type { Fingerprinter, FingerprintResult, MusicMatch } from "./fingerprint";

/** Marker a fake-mode upload can carry in its title or storage key to simulate commercial music (e2e, demos). */
export const FAKE_COMMERCIAL_MARKER = "commercial-music";

/**
 * Offline audio recognition for tests and SHORTLOOP_FAKE_PROVIDERS. Matches come from a catalogue keyed by asset
 * id; any asset whose title or storage key contains "commercial-music" matches a made-up track at 95%.
 */
export class FakeFingerprint implements Fingerprinter {
  readonly provider = "fake-fingerprint";
  readonly calls: { assetId: string; filePath: string }[] = [];

  constructor(private readonly catalogue: Record<string, MusicMatch[]> = {}) {}

  async fingerprint(audioAsset: Asset, filePath: string): Promise<FingerprintResult> {
    this.calls.push({ assetId: audioAsset.id, filePath });
    const listed = this.catalogue[audioAsset.id];
    if (listed) return { provider: this.provider, matches: listed };
    const marked = [audioAsset.title, audioAsset.storageKey].some((s) =>
      s?.toLowerCase().includes(FAKE_COMMERCIAL_MARKER),
    );
    return {
      provider: this.provider,
      matches: marked ? [{ title: "Chart Hit", owner: "Major Label Records", confidence: 0.95 }] : [],
    };
  }
}

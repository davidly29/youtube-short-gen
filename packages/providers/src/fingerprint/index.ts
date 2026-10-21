import { AcrCloudFingerprint } from "./acrcloud";
import { FakeFingerprint } from "./fake";
import type { Fingerprinter } from "./fingerprint";

export * from "./fingerprint";
export { AcrCloudFingerprint, ffmpegSampler, sampleOffsets, type AudioSampler } from "./acrcloud";
export { FAKE_COMMERCIAL_MARKER, FakeFingerprint } from "./fake";

/**
 * The music check's provider from env: `FINGERPRINT_PROVIDER=fake`, or ACRCloud when its three variables are set.
 * Undefined means the check isn't configured; publishing then records it as skipped unless FINGERPRINT_REQUIRED=1.
 */
export function fingerprintFromEnv(env: NodeJS.ProcessEnv = process.env): Fingerprinter | undefined {
  if (env.FINGERPRINT_PROVIDER === "fake") return new FakeFingerprint();
  const { ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET } = env;
  if (ACRCLOUD_HOST && ACRCLOUD_ACCESS_KEY && ACRCLOUD_ACCESS_SECRET)
    return new AcrCloudFingerprint(ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET);
  return undefined;
}

/** FINGERPRINT_REQUIRED=1: refuse to publish user-supplied audio when no music check is configured. */
export function fingerprintRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FINGERPRINT_REQUIRED === "1";
}

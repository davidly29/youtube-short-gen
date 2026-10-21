import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset } from "@shortloop/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfmpeg } from "../media/ffmpeg";
import {
  AcrCloudFingerprint,
  FakeFingerprint,
  ffmpegSampler,
  fingerprintFromEnv,
  fingerprintRequired,
  FingerprintUnavailable,
  mergeMatches,
  musicCheck,
  MUSIC_MATCH_THRESHOLD,
  needsFingerprint,
  sampleOffsets,
} from "./index";

const asset = (over: Partial<Asset> = {}): Asset =>
  Asset.parse({
    id: "a1",
    ownerId: "u1",
    kind: "audio",
    source: "upload",
    licence: { type: "owned", attestedByUserAt: "2026-10-01T00:00:00.000Z" },
    storageKey: "uploads/u1/track.mp3",
    title: "my-track.mp3",
    durationMs: 45_000,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  });

describe("fake provider", () => {
  it("covers a match", async () => {
    const fp = new FakeFingerprint({ a1: [{ title: "Song", owner: "Label", confidence: 0.93 }] });
    const r = await fp.fingerprint(asset(), "/tmp/x.mp3");
    expect(r.matches).toEqual([{ title: "Song", owner: "Label", confidence: 0.93 }]);
    expect(fp.calls).toEqual([{ assetId: "a1", filePath: "/tmp/x.mp3" }]);
  });

  it("covers no match", async () => {
    const r = await new FakeFingerprint().fingerprint(asset(), "/tmp/x.mp3");
    expect(r).toEqual({ provider: "fake-fingerprint", matches: [] });
  });

  it("matches marked uploads in fake mode", async () => {
    const r = await new FakeFingerprint().fingerprint(asset({ title: "commercial-music.mp3" }), "/x");
    expect(r.matches[0]?.confidence).toBeGreaterThan(MUSIC_MATCH_THRESHOLD);
  });
});

describe("musicCheck", () => {
  const hit = (confidence: number) => ({
    provider: "fake",
    matches: [{ title: "Chart Hit", owner: "Major Label", confidence }],
  });

  it("blocks a match above 0.8 with a readable reason", () => {
    const c = musicCheck([{ asset: asset(), result: hit(0.92) }]);
    expect(c.ok).toBe(false);
    expect(c.problems).toEqual([
      '"my-track.mp3" contains "Chart Hit" by Major Label (92% match). Remove it or use a track from the music library.',
    ]);
    expect(c.matches).toEqual([
      { title: "Chart Hit", owner: "Major Label", confidence: 0.92, assetId: "a1", blocking: true },
    ]);
  });

  it("allows matches at or below 0.8", () => {
    expect(musicCheck([{ asset: asset(), result: hit(0.8) }])).toEqual({
      ok: true,
      problems: [],
      matches: [],
    });
    expect(musicCheck([{ asset: asset(), result: hit(0.4) }]).ok).toBe(true);
  });

  it("does not block library music, but still reports the match", () => {
    const c = musicCheck([
      { asset: asset({ source: "library_music", licence: { type: "library" } }), result: hit(0.99) },
    ]);
    expect(c.ok).toBe(true);
    expect(c.matches[0]?.blocking).toBe(false);
  });

  it("blocks every source except library_music", () => {
    for (const source of ["upload", "own_channel", "stock", "ai_generated"] as const)
      expect(musicCheck([{ asset: { id: "x", source }, result: hit(0.9) }]).ok).toBe(false);
  });

  it("no matches passes", () => {
    expect(musicCheck([{ asset: asset(), result: { provider: "fake", matches: [] } }]).ok).toBe(true);
  });
});

describe("needsFingerprint", () => {
  it("checks only user-supplied audio", () => {
    expect(needsFingerprint({ kind: "audio", source: "upload" })).toBe(true);
    expect(needsFingerprint({ kind: "audio", source: "own_channel" })).toBe(true);
    expect(needsFingerprint({ kind: "audio", source: "ai_generated" })).toBe(false);
    expect(needsFingerprint({ kind: "audio", source: "library_music" })).toBe(false);
    expect(needsFingerprint({ kind: "audio", source: "stock" })).toBe(false);
    expect(needsFingerprint({ kind: "video", source: "upload" })).toBe(false); // rendered muted
  });
});

describe("sampling", () => {
  it("spreads samples over the first 180 s", () => {
    expect(sampleOffsets(5_000)).toEqual([0]);
    expect(sampleOffsets(45_000)).toEqual([0, 33_000]);
    const long = sampleOffsets(600_000);
    expect(long).toHaveLength(6);
    expect(long.at(-1)).toBe(168_000);
  });

  it("mergeMatches keeps one entry per recording at its best confidence", () => {
    expect(
      mergeMatches([
        [{ title: "A", owner: "L", confidence: 0.5 }],
        [
          { title: "a", owner: "l", confidence: 0.9 },
          { title: "B", owner: "L", confidence: 0.7 },
        ],
      ]),
    ).toEqual([
      { title: "a", owner: "l", confidence: 0.9 },
      { title: "B", owner: "L", confidence: 0.7 },
    ]);
  });

  describe("ffmpegSampler", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "fp-test-"));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    it("cuts WAV samples from a real file", async () => {
      const src = join(dir, "tone.wav");
      await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=40", src]);
      const samples = await ffmpegSampler(src);
      expect(samples).toHaveLength(2);
      for (const s of samples) expect(s.subarray(0, 4).toString()).toBe("RIFF");
    });
  });
});

describe("ACRCloud adapter (offline, recorded responses)", () => {
  const now = () => new Date("2026-10-21T10:00:00Z");
  const sampler = async () => [Buffer.from("one"), Buffer.from("two")];
  const responses = (...bodies: unknown[]) => {
    const seen: { url: string; form: FormData }[] = [];
    let i = 0;
    const f = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), form: init?.body as FormData });
      return new Response(JSON.stringify(bodies[i++] ?? bodies.at(-1)));
    }) as typeof fetch;
    return { f, seen };
  };

  it("maps matches, merges samples and signs each request", async () => {
    const { f, seen } = responses(
      {
        status: { code: 0, msg: "Success" },
        metadata: {
          music: [{ title: "Chart Hit", label: "Major Label", score: 88, artists: [{ name: "Star" }] }],
        },
      },
      {
        status: { code: 0, msg: "Success" },
        metadata: {
          music: [
            { title: "Chart Hit", label: "Major Label", score: 97 },
            { title: "Other", artists: [{ name: "Indie" }], score: "40" },
          ],
        },
      },
    );
    const acr = new AcrCloudFingerprint("identify-eu-west-1.acrcloud.com", "key", "secret", {
      fetch: f,
      sampler,
      now,
    });
    const r = await acr.fingerprint(asset(), "/x");
    expect(r).toEqual({
      provider: "acrcloud",
      matches: [
        { title: "Chart Hit", owner: "Major Label", confidence: 0.97 },
        { title: "Other", owner: "Indie", confidence: 0.4 },
      ],
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toBe("https://identify-eu-west-1.acrcloud.com/v1/identify");
    const form = seen[0]?.form as FormData;
    const ts = String(Math.floor(now().getTime() / 1000));
    const expected = createHmac("sha1", "secret")
      .update(`POST\n/v1/identify\nkey\naudio\n1\n${ts}`)
      .digest("base64");
    expect(form.get("signature")).toBe(expected);
    expect(form.get("timestamp")).toBe(ts);
    expect(form.get("access_key")).toBe("key");
    expect(form.get("sample_bytes")).toBe("3");
  });

  it("treats 'no result' as no match", async () => {
    const { f } = responses({ status: { code: 1001, msg: "No result" } });
    const r = await new AcrCloudFingerprint("h", "k", "s", { fetch: f, sampler }).fingerprint(asset(), "/x");
    expect(r.matches).toEqual([]);
  });

  it("raises FingerprintUnavailable on provider errors so the publish retries instead of passing", async () => {
    const { f } = responses({ status: { code: 3003, msg: "limit exceeded" } });
    await expect(
      new AcrCloudFingerprint("h", "k", "s", { fetch: f, sampler }).fingerprint(asset(), "/x"),
    ).rejects.toBeInstanceOf(FingerprintUnavailable);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(
      new AcrCloudFingerprint("h", "k", "s", { fetch: down, sampler }).fingerprint(asset(), "/x"),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("fingerprintFromEnv", () => {
  it("picks fake, ACRCloud or nothing", () => {
    expect(fingerprintFromEnv({ FINGERPRINT_PROVIDER: "fake" })).toBeInstanceOf(FakeFingerprint);
    expect(
      fingerprintFromEnv({ ACRCLOUD_HOST: "h", ACRCLOUD_ACCESS_KEY: "k", ACRCLOUD_ACCESS_SECRET: "s" }),
    ).toBeInstanceOf(AcrCloudFingerprint);
    expect(fingerprintFromEnv({ ACRCLOUD_HOST: "h" })).toBeUndefined();
    expect(fingerprintRequired({ FINGERPRINT_REQUIRED: "1" })).toBe(true);
    expect(fingerprintRequired({})).toBe(false);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Timeline } from "@shortloop/contracts";
import { ffmpeg, ffmpegVerbose } from "./ffmpeg";
import type { ResolvedAsset } from "./render";

/** Deterministic test media generated with FFmpeg's built-in sources (no files committed). */
export async function makeFixtureAssets(dir: string): Promise<Record<string, ResolvedAsset>> {
  const imgA = join(dir, "a.png");
  const imgB = join(dir, "b.png");
  const tone = join(dir, "tone.wav");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=1", "-frames:v", "1", imgA]);
  await ffmpeg(["-f", "lavfi", "-i", "color=c=0x2255aa:s=720x1280", "-frames:v", "1", imgB]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000", tone]);
  return {
    img_a: { path: imgA, kind: "image" },
    img_b: { path: imgB, kind: "image" },
    tone: { path: tone, kind: "audio" },
  };
}

/** A 3-second Short: a Ken Burns image, a static image, one audio track. */
export const fixtureTimeline: Timeline = {
  id: "tl_fixture",
  fps: 30,
  width: 1080,
  height: 1920,
  durationMs: 3000,
  video: [
    { assetId: "img_a", startMs: 0, endMs: 1500, srcInMs: 0, fit: "cover", motion: "kenburns" },
    { assetId: "img_b", startMs: 1500, endMs: 3000, srcInMs: 0, fit: "cover", motion: "none" },
  ],
  audio: [{ assetId: "tone", startMs: 0, endMs: 3000, gainDb: -6 }],
  captions: [],
  captionStyle: "bold-pop",
};

/** SSIM (0..1) between the frame at `atMs` in a video and a reference PNG. */
export async function compareFrame(videoPath: string, atMs: number, goldenPng: string): Promise<number> {
  const work = await mkdtemp(join(tmpdir(), "shortloop-frame-"));
  try {
    const frame = join(work, "frame.png");
    await ffmpeg(["-ss", (atMs / 1000).toFixed(3), "-i", videoPath, "-frames:v", "1", frame]);
    const log = await ffmpegVerbose(["-i", frame, "-i", goldenPng, "-lavfi", "ssim", "-f", "null", "-"]);
    const m = /All:([0-9.]+)/.exec(log);
    if (!m?.[1]) throw new Error(`could not read SSIM from ffmpeg output:\n${log.slice(-500)}`);
    return Number(m[1]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

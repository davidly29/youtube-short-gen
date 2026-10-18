import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Timeline, type Clip } from "@shortloop/contracts";
import { ENCODE_AUDIO, ENCODE_VIDEO, ffmpeg, probe } from "./ffmpeg";

export interface ResolvedAsset {
  path: string;
  kind: "video" | "image" | "audio";
}
export type AssetResolver = (assetId: string) => Promise<ResolvedAsset>;

export interface RenderOptions {
  /** Optional ASS subtitle file burned in after composition (captions, E6-02). */
  subtitlesPath?: string;
}

const W = 1080;
const H = 1920;
const FPS = 30;

const sec = (ms: number) => (ms / 1000).toFixed(3);

function fitFilter(fit: Clip["fit"]): string {
  return fit === "cover"
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

async function renderClip(clip: Clip, asset: ResolvedAsset, out: string): Promise<void> {
  const durMs = clip.endMs - clip.startMs;
  const frames = Math.max(1, Math.round((durMs / 1000) * FPS));
  if (asset.kind === "image") {
    const motion =
      clip.motion === "kenburns"
        ? `,scale=${W * 2}:${H * 2},zoompan=z='min(1+0.0012*on,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`
        : "";
    await ffmpeg([
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      asset.path,
      "-vf",
      `${fitFilter(clip.fit)}${motion},fps=${FPS},format=yuv420p`,
      "-frames:v",
      String(frames),
      "-an",
      ...ENCODE_VIDEO,
      out,
    ]);
    return;
  }
  if (asset.kind === "video") {
    await ffmpeg([
      "-stream_loop",
      "-1",
      "-ss",
      sec(clip.srcInMs),
      "-i",
      asset.path,
      "-vf",
      `${fitFilter(clip.fit)},fps=${FPS},format=yuv420p`,
      "-frames:v",
      String(frames),
      "-an",
      ...ENCODE_VIDEO,
      out,
    ]);
    return;
  }
  throw new Error(`asset ${clip.assetId} is audio and cannot be used on the video track`);
}

async function blank(durMs: number, out: string): Promise<void> {
  const frames = Math.max(1, Math.round((durMs / 1000) * FPS));
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${W}x${H}:r=${FPS}`,
    "-frames:v",
    String(frames),
    "-an",
    ...ENCODE_VIDEO,
    out,
  ]);
}

/**
 * Render a Timeline to an H.264/AAC MP4 at 1080x1920, 30 fps.
 * Video: each clip is rendered to its own segment (gaps become black), then concatenated.
 * Audio: each clip is delayed to its start and mixed; silence when there is none.
 */
export async function renderTimeline(
  input: Timeline,
  resolve: AssetResolver,
  outPath: string,
  opts: RenderOptions = {},
): Promise<void> {
  const timeline = Timeline.parse(input);
  const work = await mkdtemp(join(tmpdir(), "shortloop-render-"));
  try {
    const parts: string[] = [];
    let cursor = 0;
    const clips = [...timeline.video].sort((a, b) => a.startMs - b.startMs);
    for (const [i, clip] of clips.entries()) {
      if (clip.startMs > cursor) {
        const gap = join(work, `gap${i}.mp4`);
        await blank(clip.startMs - cursor, gap);
        parts.push(gap);
      }
      const seg = join(work, `seg${i}.mp4`);
      await renderClip(clip, await resolve(clip.assetId), seg);
      parts.push(seg);
      cursor = clip.endMs;
    }
    if (cursor < timeline.durationMs) {
      const tail = join(work, "tail.mp4");
      await blank(timeline.durationMs - cursor, tail);
      parts.push(tail);
    }
    const list = join(work, "concat.txt");
    await writeFile(list, parts.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"));
    const video = join(work, "video.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);

    const inputs = ["-i", video];
    const filters: string[] = [];
    const mixLabels: string[] = [];
    for (const [i, clip] of timeline.audio.entries()) {
      const asset = await resolve(clip.assetId);
      inputs.push("-i", asset.path);
      const idx = i + 1;
      filters.push(
        `[${idx}:a]atrim=0:${sec(clip.endMs - clip.startMs)},asetpts=PTS-STARTPTS,volume=${clip.gainDb}dB,` +
          `adelay=${clip.startMs}|${clip.startMs},aformat=sample_rates=48000:channel_layouts=stereo[a${idx}]`,
      );
      mixLabels.push(`[a${idx}]`);
    }
    if (mixLabels.length === 0) {
      inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      filters.push(`[1:a]anull[aout]`);
    } else {
      filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[aout]`);
    }
    const vfilter = opts.subtitlesPath
      ? `[0:v]ass='${opts.subtitlesPath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'")}'[vout]`
      : `[0:v]null[vout]`;
    filters.push(vfilter);
    await ffmpeg([
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      sec(timeline.durationMs),
      "-r",
      String(FPS),
      ...ENCODE_VIDEO,
      ...ENCODE_AUDIO,
      "-movflags",
      "+faststart",
      outPath,
    ]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Checks a rendered file matches the ShortLoop delivery spec. Returns a list of problems (empty = ok). */
export async function checkDeliverySpec(path: string, expectedDurationMs: number): Promise<string[]> {
  const p = await probe(path);
  const problems: string[] = [];
  if (p.width !== W || p.height !== H) problems.push(`size ${p.width}x${p.height}, expected ${W}x${H}`);
  if (p.fps !== FPS) problems.push(`fps ${p.fps}, expected ${FPS}`);
  if (p.videoCodec !== "h264") problems.push(`video codec ${p.videoCodec}, expected h264`);
  if (p.audioCodec !== "aac") problems.push(`audio codec ${p.audioCodec}, expected aac`);
  if (Math.abs(p.durationMs - expectedDurationMs) > 100)
    problems.push(`duration ${p.durationMs} ms, expected ${expectedDurationMs} ±100 ms`);
  return problems;
}

import { spawn } from "node:child_process";

/** Minimal FFmpeg runner for providers (fakes, normalisation, probing). */
export function runFfmpeg(args: string[], verbose = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-nostdin", "-y", ...(verbose ? [] : ["-loglevel", "error"]), ...args],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

export function probeDurationMs(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path,
    ]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Math.round(Number(out.trim()) * 1000)) : reject(new Error(`ffprobe ${code}`)),
    );
  });
}

/** Integrated loudness in LUFS (EBU R128). */
export async function measureLufs(path: string): Promise<number> {
  const log = await runFfmpeg(["-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], true);
  const m = /I:\s+(-?[0-9.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")));
  if (!m?.[1]) throw new Error("could not read loudness");
  return Number(m[1]);
}

/** Two-pass-quality single-pass loudnorm to the platform target (−14 LUFS), MP3 out. */
export async function normaliseLoudness(inPath: string, outPath: string, target = -14): Promise<void> {
  await runFfmpeg([
    "-i",
    inPath,
    "-af",
    `loudnorm=I=${target}:TP=-1.5:LRA=11`,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    outPath,
  ]);
}

export interface MediaProbe {
  /** Container duration; undefined for still images. */
  durationMs?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Read duration, frame size and stream types with ffprobe. Rejects on files ffprobe can't parse. */
export function probeMedia(path: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe could not read this file (${code})`));
      const j = JSON.parse(out) as {
        streams?: {
          codec_type?: string;
          width?: number;
          height?: number;
          disposition?: { attached_pic?: number };
        }[];
        format?: { duration?: string; format_name?: string };
      };
      const streams = j.streams ?? [];
      const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
      const still = /image2|png_pipe|jpeg_pipe|mjpeg/.test(j.format?.format_name ?? "");
      const seconds = Number(j.format?.duration);
      resolve({
        durationMs:
          !still && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined,
        width: video?.width,
        height: video?.height,
        hasVideo: Boolean(video),
        hasAudio: streams.some((s) => s.codec_type === "audio"),
      });
    });
  });
}

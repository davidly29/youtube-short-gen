import { spawn } from "node:child_process";

export class FFmpegError extends Error {}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => reject(new FFmpegError(`${cmd} could not start: ${e.message}`)));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new FFmpegError(`${cmd} exited ${code}: ${stderr.slice(-1500)}`)),
    );
  });
}

export async function ffmpeg(args: string[]): Promise<string> {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args]);
  return stderr;
}

/** Like ffmpeg() but keeps info-level logs (needed to read filter output such as SSIM). */
export async function ffmpegVerbose(args: string[]): Promise<string> {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]);
  return stderr;
}

export interface ProbeResult {
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
}

interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const data = JSON.parse(stdout) as { streams: FfprobeStream[]; format: { duration?: string } };
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationMs: Math.round(Number(data.format.duration ?? 0) * 1000),
    width: v?.width,
    height: v?.height,
    fps: num && den ? num / den : undefined,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
  };
}

export const ENCODE_VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];
export const ENCODE_AUDIO = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

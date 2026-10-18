import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CaptionStyleId, type CaptionWord } from "@shortloop/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpeg, ffmpegVerbose } from "../ffmpeg";
import { compareFrame } from "../fixture";
import { buildAss, paginate, SAFE_AREA } from "./presets";

const WORDS: CaptionWord[] = [
  { text: "Why", startMs: 100, endMs: 350, emphasis: false },
  { text: "do", startMs: 380, endMs: 520, emphasis: false },
  { text: "octopuses", startMs: 550, endMs: 1100, emphasis: false },
  { text: "have", startMs: 1150, endMs: 1350, emphasis: false },
  { text: "THREE", startMs: 1400, endMs: 1800, emphasis: true },
  { text: "hearts?", startMs: 1850, endMs: 2400, emphasis: false },
  { text: "Science", startMs: 2600, endMs: 3000, emphasis: false },
  { text: "explains.", startMs: 3050, endMs: 3500, emphasis: false },
];
const STYLES = CaptionStyleId.options;
const GOLDEN = (s: string) => fileURLToPath(new URL(`../../test/golden/captions-${s}.png`, import.meta.url));

let dir: string;
const videos: Record<string, string> = {};

async function renderPreview(style: CaptionStyleId): Promise<string> {
  const ass = join(dir, `${style}.ass`);
  await writeFile(ass, buildAss(WORDS, style));
  const out = join(dir, `${style}.mp4`);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1080x1920:r=30:d=3.6",
    "-vf",
    `ass='${ass}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    out,
  ]);
  return out;
}

/** Brightest luma (0–255) inside a crop of the frame at `t` seconds. */
async function maxLuma(video: string, t: number, crop: string): Promise<number> {
  const log = await ffmpegVerbose([
    "-ss",
    t.toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    `crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX`,
    "-f",
    "null",
    "-",
  ]);
  const m = /YMAX=(\d+)/.exec(log);
  return Number(m?.[1] ?? 255);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "captions-"));
  for (const s of STYLES) {
    videos[s] = await renderPreview(s);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN(s))) {
      await ffmpeg(["-ss", "1.5", "-i", videos[s] ?? "", "-frames:v", "1", GOLDEN(s)]);
    }
  }
}, 180_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pagination", () => {
  it("shows 1–3 words per page and breaks after sentence punctuation", () => {
    const pages = paginate(WORDS, 3);
    expect(pages.every((p) => p.length >= 1 && p.length <= 3)).toBe(true);
    expect(pages.map((p) => p.map((w) => w.text).join(" "))).toEqual([
      "Why do octopuses",
      "have THREE hearts?",
      "Science explains.",
    ]);
  });
});

describe.each(STYLES)("preset %s", (style) => {
  it("matches its golden frame", async () => {
    expect(await compareFrame(videos[style] ?? "", 1500, GOLDEN(style))).toBeGreaterThanOrEqual(0.97);
  });

  it("never draws into the bottom 20% or right 15% of the frame", async () => {
    const bottomH = Math.round(1920 * SAFE_AREA.bottom);
    const rightW = Math.round(1080 * SAFE_AREA.right);
    for (const t of [0.2, 0.6, 1.0, 1.5, 2.0, 2.8, 3.2]) {
      expect(
        await maxLuma(videos[style] ?? "", t, `1080:${bottomH}:0:${1920 - bottomH}`),
      ).toBeLessThanOrEqual(24);
      expect(await maxLuma(videos[style] ?? "", t, `${rightW}:1920:${1080 - rightW}:0`)).toBeLessThanOrEqual(
        24,
      );
    }
  });

  it("puts emphasis words in the accent colour", () => {
    expect(buildAss(WORDS, style)).toMatch(/\\(1?c)&H00[0-9A-F]{6}/);
  });
});

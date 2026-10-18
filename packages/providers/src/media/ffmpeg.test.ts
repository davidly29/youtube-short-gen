import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeMedia, runFfmpeg } from "./ffmpeg";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "probe-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("probeMedia", () => {
  it("reads size and duration of a video, size of an image, duration of audio", async () => {
    const mp4 = join(dir, "a.mp4");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=360x640:rate=30:duration=1",
      "-pix_fmt",
      "yuv420p",
      mp4,
    ]);
    expect(await probeMedia(mp4)).toMatchObject({ width: 360, height: 640, hasVideo: true, hasAudio: false });
    expect(Math.abs(((await probeMedia(mp4)).durationMs ?? 0) - 1000)).toBeLessThan(100);

    const png = join(dir, "a.png");
    await runFfmpeg(["-f", "lavfi", "-i", "color=red:size=100x200", "-frames:v", "1", png]);
    expect(await probeMedia(png)).toEqual({
      durationMs: undefined,
      width: 100,
      height: 200,
      hasVideo: true,
      hasAudio: false,
    });

    const wav = join(dir, "a.wav");
    await runFfmpeg(["-f", "lavfi", "-i", "sine=duration=0.5", wav]);
    expect(await probeMedia(wav)).toMatchObject({ hasVideo: false, hasAudio: true });
  });

  it("rejects files that aren't media", async () => {
    const txt = join(dir, "fake.mp4");
    await writeFile(txt, "not a video");
    await expect(probeMedia(txt)).rejects.toThrow(/could not read/);
  });
});

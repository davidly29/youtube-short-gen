import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpeg } from "./ffmpeg";
import { compareFrame, fixtureTimeline, makeFixtureAssets } from "./fixture";
import { checkDeliverySpec, renderTimeline } from "./render";

const GOLDEN = fileURLToPath(new URL("../test/golden/fixture-1000ms.png", import.meta.url));
let dir: string;
let out: string;
let renderMs = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "golden-"));
  const assets = await makeFixtureAssets(dir);
  out = join(dir, "out.mp4");
  const t0 = Date.now();
  await renderTimeline(
    fixtureTimeline,
    async (id) => {
      const a = assets[id];
      if (!a) throw new Error(`no fixture asset ${id}`);
      return a;
    },
    out,
  );
  renderMs = Date.now() - t0;
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
    await ffmpeg(["-ss", "1.000", "-i", out, "-frames:v", "1", GOLDEN]);
  }
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("golden render", () => {
  it("meets the delivery spec: 9:16, 30 fps, H.264, AAC, duration ±100 ms", async () => {
    expect(await checkDeliverySpec(out, fixtureTimeline.durationMs)).toEqual([]);
  });

  it("frame at 1 s matches the stored golden PNG (SSIM ≥ 0.97)", async () => {
    expect(await compareFrame(out, 1000, GOLDEN)).toBeGreaterThanOrEqual(0.97);
  });

  it("renders the fixture in under 60 s", () => {
    expect(renderMs).toBeLessThan(60_000);
  });
});

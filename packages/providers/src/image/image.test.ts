import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../storage";
import {
  checkImagePrompt,
  FakeImage,
  FalImage,
  fullPrompt,
  generateImageAsset,
  generationSize,
  imageFromEnv,
  ImagePromptRejected,
  PollinationsImage,
} from "./index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "img-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("prompt rules", () => {
  it.each([
    "Elon Musk waving on a rocket",
    "pikachu in a forest",
    "a Nike shoe on a table",
    "a castle in the style of Hayao Miyazaki",
  ])("rejects %s", (p) => {
    expect(checkImagePrompt(p).ok).toBe(false);
  });
  it.each(["an octopus with three glowing hearts", "a red sports car at sunset", "a mouse eating cheese"])(
    "allows %s",
    (p) => {
      expect(checkImagePrompt(p).ok).toBe(true);
    },
  );
  it("appends style presets and sizes at ~1 MP, 64-aligned", () => {
    expect(fullPrompt("a fox", "3d")).toContain("stylized 3D render");
    const s = generationSize("9:16");
    expect(s.width % 64).toBe(0);
    expect(s.height).toBeGreaterThan(s.width);
  });
});

describe("generation", () => {
  it("records provider, model and the full prompt", async () => {
    const r = await new FakeImage().generate({
      prompt: "an octopus",
      aspect: "9:16",
      style: "3d",
      outDir: dir,
    });
    expect(existsSync(r.path)).toBe(true);
    expect(r).toMatchObject({ provider: "fake", model: "fake-1" });
    expect(r.prompt).toContain("an octopus");
  });

  it("refuses blocked prompts before calling the provider", async () => {
    let called = false;
    const gen = new PollinationsImage((async () => {
      called = true;
      return new Response("x");
    }) as typeof fetch);
    await expect(gen.generate({ prompt: "Batman on a roof", aspect: "9:16", outDir: dir })).rejects.toThrow(
      ImagePromptRejected,
    );
    expect(called).toBe(false);
  });

  it("stores an AI-generated Asset recording provider, model and prompt", async () => {
    const storage = new LocalStorage(dir);
    const asset = await generateImageAsset(new FakeImage(), storage, "usr_1", {
      prompt: "a fox",
      aspect: "9:16",
      style: "3d",
    });
    expect(asset.source).toBe("ai_generated");
    expect(asset.licence).toMatchObject({ type: "ai_generated", provider: "fake", model: "fake-1" });
    expect(asset.licence.prompt).toContain("a fox");
    expect(await storage.exists(asset.storageKey)).toBe(true);
  });

  it("is swappable via IMAGE_PROVIDER", () => {
    expect(imageFromEnv({ IMAGE_PROVIDER: "fake" })).toBeInstanceOf(FakeImage);
    expect(imageFromEnv({ FAL_KEY: "k" })).toBeInstanceOf(FalImage);
    expect(imageFromEnv({})).toBeInstanceOf(PollinationsImage);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset } from "@shortloop/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../storage";
import { FakeStock, importStock, PexelsStock, PixabayStock, stockFromEnv } from "./index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stock-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const jsonFetch = (body: unknown, seen: string[] = []) =>
  (async (url: string | URL) => {
    seen.push(String(url));
    return new Response(JSON.stringify(body));
  }) as typeof fetch;

describe("search", () => {
  it("Pexels maps photos with attribution and puts portrait first, flagging landscape", async () => {
    const seen: string[] = [];
    const pexels = new PexelsStock(
      "key",
      jsonFetch(
        {
          photos: [
            {
              id: 1,
              width: 1920,
              height: 1080,
              url: "p1",
              photographer: "Ann",
              src: { large2x: "l1", medium: "m1" },
            },
            {
              id: 2,
              width: 1080,
              height: 1920,
              url: "p2",
              photographer: "Bo",
              src: { large2x: "l2", medium: "m2" },
            },
          ],
        },
        seen,
      ),
    );
    const r = await pexels.search({ query: "octopus", kind: "image", orientation: "portrait" });
    expect(seen[0]).toContain("orientation=portrait");
    expect(r.map((x) => [x.providerId, x.needsCrop])).toEqual([
      ["2", false],
      ["1", true],
    ]);
    expect(r[0]).toMatchObject({
      attribution: "Photo by Bo on Pexels",
      licenceUrl: "https://www.pexels.com/license/",
    });
  });

  it("Pexels videos respect minDurationMs and choose the tallest MP4", async () => {
    const pexels = new PexelsStock(
      "key",
      jsonFetch({
        videos: [
          {
            id: 7,
            width: 1080,
            height: 1920,
            url: "v7",
            duration: 12,
            user: { name: "Cy" },
            image: "i",
            video_files: [
              { link: "small", width: 540, height: 960, file_type: "video/mp4" },
              { link: "big", width: 1080, height: 1920, file_type: "video/mp4" },
            ],
          },
          {
            id: 8,
            width: 1080,
            height: 1920,
            url: "v8",
            duration: 2,
            user: { name: "Di" },
            image: "i",
            video_files: [],
          },
        ],
      }),
    );
    const r = await pexels.search({
      query: "sea",
      kind: "video",
      orientation: "portrait",
      minDurationMs: 5000,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.downloadUrl).toBe("big");
  });

  it("Pixabay maps images with attribution", async () => {
    const pix = new PixabayStock(
      "k",
      jsonFetch({
        hits: [
          { id: 3, pageURL: "pg", user: "Eve", imageWidth: 1080, imageHeight: 1920, largeImageURL: "L" },
        ],
      }),
    );
    const [r] = await pix.search({ query: "x", kind: "image", orientation: "portrait" });
    expect(r).toMatchObject({
      provider: "pixabay",
      attribution: "Image by Eve on Pixabay",
      needsCrop: false,
    });
  });

  it("stockFromEnv lists configured providers, Pexels first", () => {
    expect(stockFromEnv({ PEXELS_API_KEY: "a", PIXABAY_API_KEY: "b" }).map((p) => p.provider)).toEqual([
      "pexels",
      "pixabay",
    ]);
    expect(stockFromEnv({})).toEqual([]);
  });
});

describe("importStock", () => {
  it("stores the file and returns an Asset that always carries provider, licence URL and attribution", async () => {
    const storage = new LocalStorage(dir);
    const [result] = await new FakeStock().search({
      query: "Ocean waves",
      kind: "image",
      orientation: "portrait",
    });
    if (!result) throw new Error("no result");
    const asset = await importStock(
      result,
      "usr_1",
      storage,
      (async () => new Response("JPEGDATA")) as typeof fetch,
    );
    expect(Asset.parse(asset)).toBeTruthy();
    expect(asset.source).toBe("stock");
    expect(asset.licence).toMatchObject({
      type: "stock",
      provider: "fake-stock",
      licenceUrl: "https://stock.example/licence",
      attribution: "Photo by Test Author on FakeStock",
    });
    expect(await storage.exists(asset.storageKey)).toBe(true);
  });

  it("refuses results without licence information", async () => {
    const [result] = await new FakeStock().search({ query: "x", kind: "image", orientation: "portrait" });
    if (!result) throw new Error("no result");
    await expect(importStock({ ...result, attribution: "" }, "u", new LocalStorage(dir))).rejects.toThrow(
      /licence/,
    );
  });
});

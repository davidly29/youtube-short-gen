import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage, S3Storage, storageFromEnv } from "./index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("round-trips a file and reports existence", async () => {
    const s = new LocalStorage(join(dir, "root"));
    const src = join(dir, "in.txt");
    await writeFile(src, "hello");
    expect(await s.exists("a/b.txt")).toBe(false);
    await s.putFile("a/b.txt", src);
    expect(await s.exists("a/b.txt")).toBe(true);
    await s.getFile("a/b.txt", join(dir, "out.txt"));
    expect(await readFile(join(dir, "out.txt"), "utf8")).toBe("hello");
  });

  it("issues signed URLs that verify, and rejects tampering and expiry", async () => {
    const s = new LocalStorage(dir, "/api/files", "secret");
    const url = new URL(await s.signedUrl("renders/x.mp4", 60), "http://localhost");
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("sig") ?? "";
    expect(url.pathname).toBe("/api/files/renders/x.mp4");
    expect(s.verify("renders/x.mp4", expires, sig)).toBe(true);
    expect(s.verify("renders/y.mp4", expires, sig)).toBe(false);
    expect(s.verify("renders/x.mp4", Math.floor(Date.now() / 1000) - 1, sig)).toBe(false);
  });

  it("rejects path traversal keys", async () => {
    const s = new LocalStorage(dir);
    await expect(s.exists("../etc/passwd")).rejects.toThrow(/unsafe/);
    await expect(s.signedUrl("/abs")).rejects.toThrow(/unsafe/);
  });
});

describe("storageFromEnv", () => {
  it("picks S3 when S3_BUCKET is set, local otherwise", () => {
    expect(
      storageFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }),
    ).toBeInstanceOf(S3Storage);
    expect(storageFromEnv({ STORAGE_DIR: dir })).toBeInstanceOf(LocalStorage);
  });
});

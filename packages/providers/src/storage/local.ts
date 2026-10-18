import { createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { dirname, join } from "node:path";
import { assertSafeKey, type Storage } from "./storage";

/**
 * Stores objects under a directory. `signedUrl` returns `<baseUrl>/<key>?expires=…&sig=…`
 * (HMAC-SHA256), which the web app verifies before streaming the file.
 */
export class LocalStorage implements Storage {
  constructor(
    private readonly root: string,
    private readonly baseUrl = "/api/files",
    private readonly secret = "dev-only-secret",
    private readonly uploadBaseUrl = "/api/uploads/local",
  ) {}

  path(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(filePath, dest);
  }

  async getFile(key: string, destPath: string): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(this.path(key), destPath);
  }

  async exists(key: string): Promise<boolean> {
    const path = this.path(key);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    assertSafeKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${this.baseUrl}/${key}?expires=${expires}&sig=${this.sign(key, expires)}`;
  }

  async signedPutUrl(key: string, _contentType: string, expiresInSeconds = 3600): Promise<string> {
    assertSafeKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${this.uploadBaseUrl}/${key}?expires=${expires}&sig=${this.sign(`put:${key}`, expires)}`;
  }

  verifyPut(key: string, expires: number, sig: string): boolean {
    return expires > Date.now() / 1000 && this.sign(`put:${key}`, expires) === sig;
  }

  /** Write a stream (e.g. an upload request body) to `key`. */
  async putStream(key: string, body: ReadableStream<Uint8Array>): Promise<number> {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true });
    let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytes += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(body.pipeThrough(counter) as NodeReadableStream),
      createWriteStream(dest),
    );
    return bytes;
  }

  verify(key: string, expires: number, sig: string): boolean {
    return expires > Date.now() / 1000 && this.sign(key, expires) === sig;
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${key}:${expires}`).digest("hex");
  }
}

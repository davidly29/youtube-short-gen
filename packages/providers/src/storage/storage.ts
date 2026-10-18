/** Object storage for media. Production: Cloudflare R2 (S3 API). Dev/tests: local directory. */
export interface Storage {
  /** Upload a local file under `key`. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  /** Download `key` to a local file path. */
  getFile(key: string, destPath: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A time-limited URL for reading the object (signed URLs only; no public buckets). */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

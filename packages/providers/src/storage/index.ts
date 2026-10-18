import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./storage";

export { assertSafeKey, type Storage } from "./storage";
export { LocalStorage } from "./local";
export { S3Storage, type S3Config } from "./s3";

/** S3/R2 when S3_BUCKET is set, otherwise a local directory (STORAGE_DIR, default ./.storage). */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.S3_BUCKET) {
    return new S3Storage({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    });
  }
  return new LocalStorage(
    env.STORAGE_DIR ?? "./.storage",
    env.FILES_BASE_URL ?? "/api/files",
    env.FILES_SECRET,
  );
}

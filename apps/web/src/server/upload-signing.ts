import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Upload URLs point at our own route (not straight at the bucket), so browser uploads need no bucket CORS
 * and work the same with local storage and R2/Railway buckets. The URL is HMAC-signed and expires.
 */
const secret = () => process.env.FILES_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "dev-only-secret";
const sign = (key: string, expires: number) =>
  createHmac("sha256", secret()).update(`put:${key}:${expires}`).digest("hex");

export function uploadUrl(key: string, ttlSeconds = 3600): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/uploads/put/${key}?expires=${expires}&sig=${sign(key, expires)}`;
}

export function verifyUploadUrl(key: string, expires: number, sig: string): boolean {
  if (!(expires > Date.now() / 1000)) return false;
  const want = Buffer.from(sign(key, expires));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

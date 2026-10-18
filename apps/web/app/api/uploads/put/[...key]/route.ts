import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, type UploadExt } from "../../../../../src/lib/upload-rules";
import { runtime } from "../../../../../src/server/runtime";
import { verifyUploadUrl } from "../../../../../src/server/upload-signing";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/** Receives the browser's signed PUT, spools it to disk (never fully in memory), then stores it. */
export async function PUT(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const key = (await ctx.params).key.join("/");
  const url = new URL(req.url);
  if (
    !key.startsWith("uploads/") ||
    !verifyUploadUrl(key, Number(url.searchParams.get("expires")), url.searchParams.get("sig") ?? "")
  ) {
    return new Response("Upload link expired", { status: 403 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES)
    return new Response("Too large", { status: 413 });
  if (!req.body) return new Response("Empty body", { status: 400 });
  const ext = key.split(".").pop() as UploadExt;
  const dir = await mkdtemp(join(tmpdir(), "put-"));
  try {
    const file = join(dir, `upload.${ext}`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        done(bytes > MAX_UPLOAD_BYTES ? new Error("too large") : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(req.body as NodeReadableStream), limit, createWriteStream(file));
    } catch {
      return new Response(bytes > MAX_UPLOAD_BYTES ? "Too large" : "Upload interrupted", {
        status: bytes > MAX_UPLOAD_BYTES ? 413 : 400,
      });
    }
    const { storage } = await runtime();
    await storage.putFile(key, file, UPLOAD_TYPES[ext]?.mime[0] ?? "application/octet-stream");
    return new Response(null, { status: 200 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

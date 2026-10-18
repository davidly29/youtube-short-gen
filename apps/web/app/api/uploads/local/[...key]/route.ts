import { rm } from "node:fs/promises";
import { isLocalStorage } from "../../../../../src/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../../src/lib/upload-rules";
import { runtime } from "../../../../../src/server/runtime";

export const dynamic = "force-dynamic";

/** Receives a browser PUT for LocalStorage (dev / single-container). With R2 the browser PUTs to R2 directly. */
export async function PUT(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { storage } = await runtime();
  if (!isLocalStorage(storage)) return new Response("Not found", { status: 404 });
  const key = (await ctx.params).key.join("/");
  const url = new URL(req.url);
  if (!storage.verifyPut(key, Number(url.searchParams.get("expires")), url.searchParams.get("sig") ?? "")) {
    return new Response("Upload link expired", { status: 403 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES)
    return new Response("Too large", { status: 413 });
  if (!req.body) return new Response("Empty body", { status: 400 });
  const bytes = await storage.putStream(key, req.body);
  if (bytes > MAX_UPLOAD_BYTES) {
    await rm(storage.path(key), { force: true });
    return new Response("Too large", { status: 413 });
  }
  return new Response(null, { status: 200 });
}

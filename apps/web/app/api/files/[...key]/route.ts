import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { isLocalStorage } from "../../../../src/server/storage";
import { runtime } from "../../../../src/server/runtime";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp3: "audio/mpeg",
  json: "application/json",
  wav: "audio/wav",
  mov: "video/quicktime",
};

/** Serves LocalStorage files behind HMAC-signed, expiring URLs (with Range support for video seeking). */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { storage } = await runtime();
  if (!isLocalStorage(storage)) return new Response("Not found", { status: 404 });
  const key = (await ctx.params).key.join("/");
  const url = new URL(req.url);
  if (!storage.verify(key, Number(url.searchParams.get("expires")), url.searchParams.get("sig") ?? "")) {
    return new Response("Link expired", { status: 403 });
  }
  const path = storage.path(key);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
      },
    });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, {
    headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes" },
  });
}

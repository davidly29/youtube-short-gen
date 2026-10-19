import "server-only";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, inArray, schema } from "@shortloop/db";
import { recordAudit } from "@shortloop/pipeline";
import { probeMedia } from "@shortloop/providers";
import { z } from "zod";
import { checkUpload, MAX_UPLOAD_BYTES, UPLOAD_TYPES, type UploadExt } from "../lib/upload-rules";
import { UserError } from "./errors";
import { runtime } from "./runtime";
import { uploadUrl } from "./upload-signing";

export const PresignRequest = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().max(100).default(""),
  size: z.number().int().nonnegative(),
  attested: z.boolean(),
});

const userPrefix = (userId: string) => `uploads/${userId}/`;

/** Step 1: validate, then hand back a signed URL (our own upload route) the browser PUTs the file to. */
export async function presignUpload(userId: string, input: unknown) {
  const req = PresignRequest.parse(input);
  const check = checkUpload({ name: req.filename, size: req.size, type: req.contentType }, req.attested);
  if (!check.ok) throw new UserError(check.error);
  const key = `${userPrefix(userId)}${randomUUID()}.${check.ext}`;
  const contentType = req.contentType || UPLOAD_TYPES[check.ext].mime[0];
  return { key, url: uploadUrl(key), contentType };
}

export const CompleteRequest = z.object({
  key: z.string().min(1).max(300),
  filename: z.string().min(1).max(200),
  attested: z.boolean(),
});

/** Step 2: the file is in storage. Probe it, and record it as the user's own, attested asset. */
export async function completeUpload(userId: string, input: unknown) {
  const req = CompleteRequest.parse(input);
  if (!req.key.startsWith(userPrefix(userId)) || req.key.includes(".."))
    throw new UserError("Unknown upload.");
  const ext = req.key.split(".").pop() as UploadExt;
  const rt = await runtime();
  if (!(await rt.storage.exists(req.key))) throw new UserError("The upload didn't arrive. Please try again.");
  const dir = await mkdtemp(join(tmpdir(), "upload-"));
  try {
    const local = join(dir, `file.${ext}`);
    await rt.storage.getFile(req.key, local);
    const size = (await stat(local)).size;
    const check = checkUpload({ name: `x.${ext}`, size }, req.attested);
    if (!check.ok) throw new UserError(check.error);
    if (size > MAX_UPLOAD_BYTES) throw new UserError("Files over 2 GB aren't accepted.");
    let probe;
    try {
      probe = await probeMedia(local);
    } catch {
      throw new UserError(`"${req.filename}" couldn't be read as ${check.kind}. Is the file damaged?`);
    }
    if (check.kind === "audio" ? !probe.hasAudio : !probe.hasVideo) {
      throw new UserError(`"${req.filename}" doesn't contain ${check.kind}.`);
    }
    const id = `ast_${randomUUID()}`;
    const attestedByUserAt = new Date().toISOString();
    await rt.db.insert(schema.assets).values({
      id,
      ownerId: userId,
      kind: check.kind,
      source: "upload",
      licence: { type: "owned", attestedByUserAt },
      storageKey: req.key,
      title: req.filename
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .slice(0, 200),
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
    });
    await recordAudit(rt.db, {
      ownerId: userId,
      type: "asset.upload_attested",
      subjectId: id,
      data: {
        filename: req.filename,
        statement: "I own or have rights to this media",
        attestedByUserAt,
        bytes: size,
      },
    });
    return id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function listLibrary(userId: string) {
  const rt = await runtime();
  const rows = await rt.db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.ownerId, userId), eq(schema.assets.source, "upload")))
    .orderBy(desc(schema.assets.createdAt));
  return Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title ?? a.id,
      durationMs: a.durationMs,
      width: a.width,
      height: a.height,
      attestedAt: a.licence.attestedByUserAt,
      createdAt: a.createdAt,
      url: await rt.storage.signedUrl(a.storageKey, 3600),
    })),
  );
}
export type LibraryItem = Awaited<ReturnType<typeof listLibrary>>[number];

/** Only the caller's own upload ids survive. */
export async function ownedUploads(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { db } = await runtime();
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        inArray(schema.assets.id, ids),
        eq(schema.assets.ownerId, userId),
        eq(schema.assets.source, "upload"),
      ),
    );
  return rows.map((r) => r.id);
}

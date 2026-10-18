import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asset } from "@shortloop/contracts";
import type { Storage } from "../storage";

export interface StockQuery {
  query: string;
  kind: "image" | "video";
  orientation: "portrait";
  minDurationMs?: number;
  perPage?: number;
}

export interface StockResult {
  provider: string;
  providerId: string;
  kind: "image" | "video";
  downloadUrl: string;
  previewUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  durationMs?: number;
  author: string;
  licenceUrl: string;
  attribution: string;
  /** Landscape or square media that will be cropped to 9:16. */
  needsCrop: boolean;
}

export interface StockProvider {
  readonly provider: string;
  search(q: StockQuery): Promise<StockResult[]>;
}

/** Portrait first (and longer videos first within each group), landscape last and flagged. */
export function rankPortraitFirst(results: StockResult[]): StockResult[] {
  return results
    .map((r) => ({ ...r, needsCrop: r.height <= r.width }))
    .sort((a, b) => Number(a.needsCrop) - Number(b.needsCrop) || (b.durationMs ?? 0) - (a.durationMs ?? 0));
}

/**
 * Download a stock result into storage and return it as an Asset with a full licence record
 * (provider, licence URL, attribution). Throws if any licence field is missing.
 */
export async function importStock(
  result: StockResult,
  ownerId: string,
  storage: Storage,
  fetchImpl: typeof fetch = fetch,
): Promise<Asset> {
  if (!result.provider || !result.licenceUrl || !result.attribution) {
    throw new Error(`stock result ${result.providerId} is missing licence information`);
  }
  const res = await fetchImpl(result.downloadUrl);
  if (!res.ok) throw new Error(`stock download failed: ${res.status}`);
  const ext = result.kind === "video" ? "mp4" : "jpg";
  const id = `ast_${randomUUID()}`;
  const storageKey = `assets/${ownerId}/${id}.${ext}`;
  const dir = await mkdtemp(join(tmpdir(), "stock-"));
  try {
    const file = join(dir, `media.${ext}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await storage.putFile(storageKey, file, result.kind === "video" ? "video/mp4" : "image/jpeg");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return Asset.parse({
    id,
    ownerId,
    kind: result.kind,
    source: "stock",
    licence: {
      type: "stock",
      provider: result.provider,
      licenceUrl: result.licenceUrl,
      attribution: result.attribution,
    },
    storageKey,
    durationMs: result.durationMs,
    width: result.width,
    height: result.height,
    createdAt: new Date().toISOString(),
  });
}

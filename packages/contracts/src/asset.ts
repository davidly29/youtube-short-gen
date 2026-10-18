import { z } from "zod";
import { Id, IsoDateTime, Ms } from "./common";

export const LicenceType = z.enum(["owned", "stock", "ai_generated", "library"]);

export const Licence = z.object({
  type: LicenceType,
  provider: z.string().min(1).optional(),
  licenceUrl: z.url().optional(),
  attribution: z.string().min(1).optional(),
  /** Set when the user ticked "I own or have rights to this media" (E2-01). */
  attestedByUserAt: IsoDateTime.optional(),
});
export type Licence = z.infer<typeof Licence>;

export const AssetKind = z.enum(["video", "image", "audio"]);
export const AssetSource = z.enum(["upload", "own_channel", "stock", "ai_generated", "library_music"]);

export const Asset = z.object({
  id: Id,
  ownerId: Id,
  kind: AssetKind,
  source: AssetSource,
  licence: Licence,
  storageKey: z.string().min(1),
  durationMs: Ms.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: IsoDateTime,
});
export type Asset = z.infer<typeof Asset>;

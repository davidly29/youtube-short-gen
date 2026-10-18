import { z } from "zod";

/** Hard cap on a ShortLoop video: 3 minutes. */
export const MAX_SHORT_DURATION_MS = 180_000;

export const Id = z.string().min(1);
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Ms = z.number().int().nonnegative();

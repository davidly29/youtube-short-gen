import { z } from "zod";
import { Id, Ms } from "./common";

export const Beat = z.object({
  id: Id,
  text: z.string().min(1),
  /** What to show while this beat is spoken; drives stock/AI visual search (E5-02). */
  visualQuery: z.string().min(1),
  estDurationMs: Ms,
});
export type Beat = z.infer<typeof Beat>;

export const Script = z.object({
  id: Id,
  projectId: Id,
  title: z.string().min(1),
  hook: z.string().min(1),
  beats: z.array(Beat).min(1),
  cta: z.string(),
  /** BCP 47 language tag, e.g. "en" or "en-IE". */
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  wordCount: z.number().int().nonnegative(),
});
export type Script = z.infer<typeof Script>;

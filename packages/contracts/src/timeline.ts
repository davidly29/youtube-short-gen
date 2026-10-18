import { z } from "zod";
import { Id, MAX_SHORT_DURATION_MS, Ms } from "./common";

/** Caption presets implemented by @shortloop/render (E6-02). */
export const CaptionStyleId = z.enum([
  "bold-pop",
  "clean-subtitle",
  "highlight-word",
  "karaoke",
  "boxed",
  "minimal",
]);
export type CaptionStyleId = z.infer<typeof CaptionStyleId>;

const spanIsOrdered = (v: { startMs: number; endMs: number }) => v.endMs > v.startMs;
const orderedMsg = { message: "endMs must be greater than startMs", path: ["endMs"] };

export const Clip = z
  .object({
    assetId: Id,
    startMs: Ms,
    endMs: Ms,
    /** Offset into the source asset where playback starts. */
    srcInMs: Ms,
    fit: z.enum(["cover", "contain"]),
    motion: z.enum(["none", "kenburns"]),
  })
  .refine(spanIsOrdered, orderedMsg);
export type Clip = z.infer<typeof Clip>;

export const AudioClip = z
  .object({
    assetId: Id,
    startMs: Ms,
    endMs: Ms,
    gainDb: z.number().min(-60).max(12),
  })
  .refine(spanIsOrdered, orderedMsg);
export type AudioClip = z.infer<typeof AudioClip>;

export const CaptionWord = z
  .object({
    text: z.string().min(1),
    startMs: Ms,
    endMs: Ms,
    emphasis: z.boolean(),
  })
  .refine(spanIsOrdered, orderedMsg);
export type CaptionWord = z.infer<typeof CaptionWord>;

export const Timeline = z
  .object({
    id: Id,
    fps: z.literal(30),
    width: z.literal(1080),
    height: z.literal(1920),
    durationMs: z.number().int().positive().max(MAX_SHORT_DURATION_MS),
    video: z.array(Clip),
    audio: z.array(AudioClip),
    captions: z.array(CaptionWord),
    captionStyle: CaptionStyleId,
  })
  .superRefine((t, ctx) => {
    const tracks = [
      ["video", t.video],
      ["audio", t.audio],
      ["captions", t.captions],
    ] as const;
    for (const [track, items] of tracks) {
      items.forEach((item, i) => {
        if (item.endMs > t.durationMs) {
          ctx.addIssue({
            code: "custom",
            path: [track, i, "endMs"],
            message: `ends at ${item.endMs} ms, after the timeline's durationMs (${t.durationMs})`,
          });
        }
      });
    }
    // The video track is a single layer: clips may touch but never overlap.
    const sorted = t.video.map((c, i) => ({ c, i })).sort((a, b) => a.c.startMs - b.c.startMs);
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1];
      const cur = sorted[k];
      if (prev && cur && cur.c.startMs < prev.c.endMs) {
        ctx.addIssue({
          code: "custom",
          path: ["video", cur.i, "startMs"],
          message: `video clip ${cur.i} overlaps clip ${prev.i}`,
        });
      }
    }
  });
export type Timeline = z.infer<typeof Timeline>;

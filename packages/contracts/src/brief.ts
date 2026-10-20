import { z } from "zod";
import { Id } from "./common";
import { TrendSource } from "./trends";

/** Short formats a brief item can suggest: the same slugs as the E9-02 playbooks. */
export const FormatSlug = z.enum(["trend-explainer", "myth-vs-fact", "top-3-list", "news-in-60s"]);
export type FormatSlug = z.infer<typeof FormatSlug>;

export const BriefSource = z.object({
  url: z.url(),
  title: z.string().min(1).max(500),
  source: TrendSource,
});
export type BriefSource = z.infer<typeof BriefSource>;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** One ready-to-make angle in a daily brief (E3-03). */
export const BriefItem = z.object({
  topicId: Id,
  angle: z.string().min(1).max(200),
  /** Hook-first opener, at most 12 words (same rule as scripts). */
  hook: z
    .string()
    .min(1)
    .max(120)
    .refine((s) => words(s) <= 12, "hook must be at most 12 words"),
  format: FormatSlug,
  whyNow: z.string().min(1).max(200),
  sources: z.array(BriefSource).min(1).max(5),
});
export type BriefItem = z.infer<typeof BriefItem>;

/** Calendar day the brief is for (UTC), `YYYY-MM-DD`. */
export const BriefDate = z.iso.date();

/**
 * A channel's daily brief: 3–5 items, or fewer with `partial: true` when the niche had too few fresh
 * topics (never padded with stale ones). `generatedWith` says whether the owner's LLM key wrote the
 * angles or the free template did.
 */
export const Brief = z
  .object({
    id: Id,
    channelId: Id,
    date: BriefDate,
    items: z.array(BriefItem).max(5),
    generatedWith: z.enum(["llm", "template"]),
    partial: z.boolean(),
  })
  .refine((b) => (b.partial ? b.items.length < 3 : b.items.length >= 3), {
    message: "a brief has 3–5 items unless it is marked partial (then fewer than 3)",
    path: ["items"],
  });
export type Brief = z.infer<typeof Brief>;

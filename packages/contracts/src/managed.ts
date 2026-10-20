import { z } from "zod";
import { PLANS, type PlanId } from "./billing";
import { ProviderCapability } from "./keys";

/**
 * ShortLoop AI (ADR 0007): AI on ShortLoop's own keys for paid plans, with cost guardrails. Prices are list
 * prices (Oct 2026) rounded up, so estimates err on the side of over-counting. Update them when vendors change
 * prices (Gemini 3.8 Flash doubles on 1 Jan 2027).
 */
export const MANAGED_PRICES = {
  /** USD per 1M tokens. */
  geminiText: { input: 1.5, output: 7.5 },
  /** USD per image. fal Flux schnell is $0.003/MP and bills up to 2 MP for a 9:16 frame. */
  falImage: 0.006,
  /** USD per image, Gemini "Nano Banana" at ~1K. */
  geminiImage: 0.045,
  /** USD per 1K characters, ElevenLabs Flash list price. */
  elevenlabsPer1kChars: 0.04,
} as const;

/** Owner decision: a user's ShortLoop AI spend per month is capped at 25% of their plan price. */
export const MANAGED_MONTHLY_SHARE = 0.25;

export const ManagedTier = z.enum(["creator", "pro", "admin"]);
export type ManagedTier = z.infer<typeof ManagedTier>;

export interface ManagedLimits {
  /** USD of ShortLoop AI per calendar month (UTC). */
  monthlyUsd: number;
  /** Productions (Shorts) that may use ShortLoop AI per UTC day. */
  shortsPerDay: number;
  /** USD of ShortLoop AI per project, all stages and swaps included. */
  perShortUsd: number;
  /** AI image swaps per project on ShortLoop AI. */
  imageSwapsPerShort: number;
  /** AI script generations per project on ShortLoop AI (first draft + rewrites). */
  scriptsPerShort: number;
}

const planLimits = (plan: PlanId, shortsPerDay: number): ManagedLimits => ({
  monthlyUsd: Math.round(PLANS[plan].priceUsdMonthly * MANAGED_MONTHLY_SHARE * 100) / 100,
  shortsPerDay,
  perShortUsd: 0.25,
  imageSwapsPerShort: 10,
  scriptsPerShort: 4,
});

/** Premium images cost more per Short; the per-Short limit is raised when a Short spent its AI-video credit. */
export const PREMIUM_PER_SHORT_USD = 0.6;

export const MANAGED_LIMITS: Record<ManagedTier, ManagedLimits> = {
  creator: planLimits("creator", 5),
  pro: planLimits("pro", 15),
  // Admins (the owner and team) are still metered; the ceiling is set by MANAGED_ADMIN_MONTHLY_USD (default 50).
  admin: { monthlyUsd: 50, shortsPerDay: 50, perShortUsd: 1, imageSwapsPerShort: 30, scriptsPerShort: 10 },
};

/** One metered call on ShortLoop's keys. */
export const AiUsage = z.object({
  ownerId: z.string(),
  projectId: z.string().optional(),
  jobId: z.string().optional(),
  capability: ProviderCapability,
  provider: z.string(),
  model: z.string(),
  /** Tokens, images or characters, depending on the capability. */
  units: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** True for a visual swap made on the review screen. */
  swap: z.boolean().default(false),
});
export type AiUsage = z.infer<typeof AiUsage>;

/** Why ShortLoop AI wasn't used for a call; shown to the user. */
export const ManagedDenial = z.enum([
  "disabled",
  "platform_budget",
  "monthly_cap",
  "daily_shorts",
  "per_short",
  "swaps",
  "scripts",
]);
export type ManagedDenial = z.infer<typeof ManagedDenial>;

export const MANAGED_DENIAL_MESSAGE: Record<ManagedDenial, string> = {
  disabled: "ShortLoop AI is switched off right now.",
  platform_budget: "ShortLoop AI has reached today's limit for everyone.",
  monthly_cap: "You've used this month's ShortLoop AI allowance.",
  daily_shorts: "You've reached today's limit of Shorts on ShortLoop AI.",
  per_short: "This Short has used its ShortLoop AI allowance.",
  swaps: "This Short has used its AI image swaps on ShortLoop AI.",
  scripts: "This project has used its AI script rewrites on ShortLoop AI.",
};

/** Estimated tokens for text when the provider doesn't report usage (≈4 characters per token, rounded up). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function costOf(
  kind: "geminiText" | "falImage" | "geminiImage" | "elevenlabs",
  units: { input?: number; output?: number; images?: number; chars?: number },
): number {
  switch (kind) {
    case "geminiText":
      return (
        ((units.input ?? 0) * MANAGED_PRICES.geminiText.input +
          (units.output ?? 0) * MANAGED_PRICES.geminiText.output) /
        1e6
      );
    case "falImage":
      return (units.images ?? 1) * MANAGED_PRICES.falImage;
    case "geminiImage":
      return (units.images ?? 1) * MANAGED_PRICES.geminiImage;
    case "elevenlabs":
      return ((units.chars ?? 0) / 1000) * MANAGED_PRICES.elevenlabsPer1kChars;
  }
}

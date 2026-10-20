import { z } from "zod";

/**
 * Bring-your-own-key: AI and stock providers a user can connect with their own API key, so each creator
 * pays their providers directly. The secret itself never appears in any contract shape.
 */
export const ApiKeyProvider = z.enum([
  "anthropic",
  "openai",
  "gemini",
  "elevenlabs",
  "fal",
  "pexels",
  "pixabay",
]);
export type ApiKeyProvider = z.infer<typeof ApiKeyProvider>;

/** What each provider is used for in the pipeline. */
export const ProviderCapability = z.enum(["llm", "image", "tts", "stock"]);
export type ProviderCapability = z.infer<typeof ProviderCapability>;

export const PROVIDER_CAPABILITIES: Record<ApiKeyProvider, readonly ProviderCapability[]> = {
  anthropic: ["llm"],
  openai: ["llm"],
  gemini: ["llm", "image"],
  elevenlabs: ["tts"],
  fal: ["image"],
  pexels: ["stock"],
  pixabay: ["stock"],
};

/** Input when a user saves a key. Models are optional overrides of the adapter defaults. */
export const SaveApiKey = z.object({
  provider: ApiKeyProvider,
  key: z.string().trim().min(8, "That doesn't look like an API key").max(500),
  model: z.string().trim().max(100).optional(),
  imageModel: z.string().trim().max(100).optional(),
});
export type SaveApiKey = z.infer<typeof SaveApiKey>;

/** Why a provider call failed, in terms the user can act on (ADR 0007). */
export const ProviderErrorKind = z.enum([
  "auth", // key rejected or lacks permission: fix the key
  "quota", // out of quota or credit (incl. a free tier with no access): fix billing
  "rate_limit", // too many requests right now: wait
  "unavailable", // provider down or overloaded: try later
  "blocked", // the provider refused this prompt (safety)
  "other",
]);
export type ProviderErrorKind = z.infer<typeof ProviderErrorKind>;

/** The last error a saved key hit, shown in Settings. */
export const KeyError = z.object({
  kind: ProviderErrorKind,
  capability: ProviderCapability,
  message: z.string().max(500),
  at: z.string(),
});
export type KeyError = z.infer<typeof KeyError>;

/** A job this key can't do (e.g. images on a free Gemini tier), learned from the provider's first refusal. */
export const KeyUnavailable = z.object({
  capability: ProviderCapability,
  reason: z.string().max(300),
  at: z.string(),
});
export type KeyUnavailable = z.infer<typeof KeyUnavailable>;

/** A saved key as the app may show it: masked, never the secret. */
export const ApiKeyInfo = z.object({
  provider: ApiKeyProvider,
  last4: z.string().max(4),
  model: z.string().optional(),
  imageModel: z.string().optional(),
  verifiedAt: z.string().optional(),
  updatedAt: z.string(),
  /** Last time a call with this key succeeded. */
  lastOkAt: z.string().optional(),
  lastError: KeyError.optional(),
  unavailable: z.array(KeyUnavailable).default([]),
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfo>;

/** Adapter defaults, shown in Settings and overridable per user (providers rename models often). */
export const DEFAULT_MODELS = {
  anthropic: { text: "claude-sonnet-5-5" },
  openai: { text: "gpt-5-mini" },
  gemini: { text: "gemini-3.8-flash", image: "gemini-3.1-flash-image" },
  fal: { image: "fal-ai/flux/schnell" },
} as const;

/** The free provider a job falls back to (Pollinations images, Edge voices). Scripts have none. */
export const FREE = "free" as const;
/** AI on ShortLoop's own keys, for paid plans (ADR 0007). Metered and capped. */
export const SHORTLOOP = "shortloop" as const;
/** ShortLoop's premium images (Gemini); each Short that uses them spends one AI-video credit. */
export const SHORTLOOP_PREMIUM = "shortloop_premium" as const;

export const LlmChoice = z.enum([SHORTLOOP, "anthropic", "openai", "gemini"]);
export type LlmChoice = z.infer<typeof LlmChoice>;
export const ImageChoice = z.enum([FREE, SHORTLOOP, SHORTLOOP_PREMIUM, "fal", "gemini"]);
export type ImageChoice = z.infer<typeof ImageChoice>;
export const VoiceChoice = z.enum([FREE, SHORTLOOP, "elevenlabs"]);
export type VoiceChoice = z.infer<typeof VoiceChoice>;

/**
 * Which provider does each job (ADR 0007). Unset means the default for that job: the user's own key if they
 * have a suitable one (newest script key; fal for images; ElevenLabs for voice), else ShortLoop AI when their
 * plan includes it, else the free provider (no free provider exists for scripts).
 */
export const ProviderRouting = z.object({
  llm: LlmChoice.optional(),
  image: ImageChoice.optional(),
  tts: VoiceChoice.optional(),
});
export type ProviderRouting = z.infer<typeof ProviderRouting>;

export interface RoutableKey {
  provider: ApiKeyProvider;
  updatedAt: string;
  unavailable?: readonly { capability: ProviderCapability }[];
}

export interface ResolvedRouting {
  llm?: LlmChoice;
  image: ImageChoice;
  tts: VoiceChoice;
}

const usable = (k: RoutableKey, cap: ProviderCapability) =>
  PROVIDER_CAPABILITIES[k.provider].includes(cap) && !k.unavailable?.some((u) => u.capability === cap);

/**
 * Pure: which provider each job uses, given the saved keys, the user's choices and whether their plan includes
 * ShortLoop AI. A choice that can't be honoured (key missing or marked unavailable for that job, or ShortLoop AI
 * not on their plan) falls back to the default for that job. Shared by the worker, the web app and the Settings
 * page so they always agree. Budget limits are applied later, per call (they fall back to free at run time).
 */
export function resolveRouting(
  keys: readonly RoutableKey[],
  routing: ProviderRouting = {},
  opts: { managed?: boolean | Partial<Record<"llm" | "image" | "tts", boolean>> } = {},
): ResolvedRouting {
  const m = opts.managed;
  const managedFor = (cap: ProviderCapability) =>
    m === true || (typeof m === "object" && m !== null && m[cap as "llm" | "image" | "tts"] === true);
  const has = (provider: string, cap: ProviderCapability) =>
    keys.some((k) => k.provider === provider && usable(k, cap));
  const ok = (choice: string | undefined, cap: ProviderCapability) =>
    choice !== undefined &&
    (choice === FREE
      ? cap !== "llm"
      : choice === SHORTLOOP || choice === SHORTLOOP_PREMIUM
        ? managedFor(cap)
        : has(choice, cap));

  const newestLlm = [...keys]
    .filter((k) => LlmChoice.options.includes(k.provider as LlmChoice) && usable(k, "llm"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.provider as LlmChoice | undefined;
  const llm: LlmChoice | undefined = ok(routing.llm, "llm")
    ? routing.llm
    : (newestLlm ?? (managedFor("llm") ? SHORTLOOP : undefined));
  const image: ImageChoice = ok(routing.image, "image")
    ? (routing.image as ImageChoice)
    : has("fal", "image")
      ? "fal"
      : managedFor("image")
        ? SHORTLOOP
        : FREE;
  const tts: VoiceChoice = ok(routing.tts, "tts")
    ? (routing.tts as VoiceChoice)
    : has("elevenlabs", "tts")
      ? "elevenlabs"
      : managedFor("tts")
        ? SHORTLOOP
        : FREE;
  return { llm, image, tts };
}

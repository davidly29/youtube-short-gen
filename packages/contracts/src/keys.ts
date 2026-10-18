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

/** A saved key as the app may show it: masked, never the secret. */
export const ApiKeyInfo = z.object({
  provider: ApiKeyProvider,
  last4: z.string().max(4),
  model: z.string().optional(),
  imageModel: z.string().optional(),
  verifiedAt: z.string().optional(),
  updatedAt: z.string(),
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfo>;

/** Adapter defaults, shown in Settings and overridable per user (providers rename models often). */
export const DEFAULT_MODELS = {
  anthropic: { text: "claude-sonnet-5-5" },
  openai: { text: "gpt-5-mini" },
  gemini: { text: "gemini-3.8-flash", image: "gemini-3.1-flash-image" },
  fal: { image: "fal-ai/flux/schnell" },
} as const;

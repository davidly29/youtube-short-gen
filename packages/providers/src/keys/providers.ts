import type { ApiKeyProvider } from "@shortloop/contracts";
import { FakeImage, FalImage, GeminiImage, type ImageGen } from "../image";
import { AnthropicLLM, FakeScriptLLM, GeminiLLM, OpenAILLM, type LLM } from "../llm";
import { FakeStock, PexelsStock, PixabayStock, type StockProvider } from "../stock";
import { ElevenLabsTTS, FakeTTS, type TTS } from "../tts";

/** A decrypted user key, held only in memory for the duration of a job or request. */
export interface UserKey {
  provider: ApiKeyProvider;
  key: string;
  model?: string;
  imageModel?: string;
  updatedAt: string;
}

export interface ProviderSet {
  llm?: LLM;
  image?: ImageGen;
  tts?: TTS;
  stock: StockProvider[];
}

const LLM_PROVIDERS: ApiKeyProvider[] = ["anthropic", "openai", "gemini"];
const IMAGE_PROVIDERS: ApiKeyProvider[] = ["fal", "gemini"];

const newest = (keys: UserKey[], among: ApiKeyProvider[]) =>
  keys.filter((k) => among.includes(k.provider)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

/**
 * Build the providers a user's own keys unlock. When a user has several keys for one job (e.g. Anthropic and
 * Gemini for scripts), the most recently saved wins. `fake` swaps every adapter for its offline fake.
 */
export function providersFromKeys(
  keys: UserKey[],
  opts: { fetch?: typeof fetch; fake?: boolean } = {},
): ProviderSet {
  const f = opts.fetch ?? fetch;
  const llmKey = newest(keys, LLM_PROVIDERS);
  const imageKey = newest(keys, IMAGE_PROVIDERS);
  const tts = keys.find((k) => k.provider === "elevenlabs");
  const set: ProviderSet = { stock: [] };

  if (llmKey) {
    set.llm = opts.fake
      ? new FakeScriptLLM()
      : llmKey.provider === "anthropic"
        ? new AnthropicLLM(llmKey.key, llmKey.model)
        : llmKey.provider === "openai"
          ? new OpenAILLM(llmKey.key, llmKey.model)
          : new GeminiLLM(llmKey.key, llmKey.model, f);
  }
  if (imageKey) {
    set.image = opts.fake
      ? new FakeImage()
      : imageKey.provider === "fal"
        ? new FalImage(imageKey.key, imageKey.imageModel ?? imageKey.model, f)
        : new GeminiImage(imageKey.key, imageKey.imageModel, f);
  }
  if (tts) set.tts = opts.fake ? new FakeTTS() : new ElevenLabsTTS(tts.key, tts.model, f);
  for (const k of keys) {
    if (k.provider === "pexels") set.stock.push(opts.fake ? new FakeStock() : new PexelsStock(k.key, f));
    if (k.provider === "pixabay") set.stock.push(opts.fake ? new FakeStock() : new PixabayStock(k.key, f));
  }
  return set;
}

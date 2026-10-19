import {
  resolveRouting,
  type ApiKeyProvider,
  type ProviderCapability,
  type ProviderRouting,
  type ResolvedRouting,
} from "@shortloop/contracts";
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
  /** Which provider each job uses (own key, "shortloop" or "free"); the caller supplies shortloop and free. */
  route: ResolvedRouting;
}

/** Users' keys carry their health so routing can skip a key that can't do a job (ADR 0007). */
export type HealthyKey = UserKey & { unavailable?: readonly { capability: ProviderCapability }[] };

/**
 * Build the providers a user's own keys unlock, following their routing choices (Settings → API keys). Jobs routed
 * to ShortLoop AI or to the free provider are left unset here; `route` tells the caller which to plug in.
 * `fake` swaps every adapter for its offline fake.
 */
export function providersFromKeys(
  keys: HealthyKey[],
  opts: { fetch?: typeof fetch; fake?: boolean; routing?: ProviderRouting; managed?: boolean } = {},
): ProviderSet {
  const f = opts.fetch ?? fetch;
  const route = resolveRouting(keys, opts.routing ?? {}, { managed: opts.managed });
  const keyFor = (p: string | undefined) => keys.find((k) => k.provider === p);
  const set: ProviderSet = { stock: [], route };

  const llmKey = keyFor(route.llm);
  if (llmKey) {
    set.llm = opts.fake
      ? new FakeScriptLLM()
      : llmKey.provider === "anthropic"
        ? new AnthropicLLM(llmKey.key, llmKey.model)
        : llmKey.provider === "openai"
          ? new OpenAILLM(llmKey.key, llmKey.model)
          : new GeminiLLM(llmKey.key, llmKey.model, f);
  }
  const imageKey = keyFor(route.image);
  if (imageKey) {
    set.image = opts.fake
      ? new FakeImage()
      : imageKey.provider === "fal"
        ? new FalImage(imageKey.key, imageKey.imageModel ?? imageKey.model, f)
        : new GeminiImage(imageKey.key, imageKey.imageModel, f);
  }
  const tts = keyFor(route.tts);
  if (tts) set.tts = opts.fake ? new FakeTTS() : new ElevenLabsTTS(tts.key, tts.model, f);
  for (const k of keys) {
    if (k.provider === "pexels") set.stock.push(opts.fake ? new FakeStock() : new PexelsStock(k.key, f));
    if (k.provider === "pixabay") set.stock.push(opts.fake ? new FakeStock() : new PixabayStock(k.key, f));
  }
  return set;
}

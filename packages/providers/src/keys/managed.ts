import { costOf } from "@shortloop/contracts";
import { FakeImage, FalImage, GeminiImage, type ImageGen } from "../image";
import { FakeScriptLLM, GeminiLLM, type LLM } from "../llm";
import { ElevenLabsTTS, FakeTTS, type TTS } from "../tts";
import type { Instrumentation } from "../observe";

type Price = NonNullable<Instrumentation["price"]>;

export interface ManagedProvider<T> {
  provider: T;
  price: Price;
}

/** ShortLoop AI (ADR 0007): providers on ShortLoop's own keys for paid plans. Each comes with its price. */
export interface ManagedProviders {
  llm?: ManagedProvider<LLM>;
  image?: ManagedProvider<ImageGen>;
  /** Premium images (Gemini); a Short using them spends one AI-video credit. */
  premiumImage?: ManagedProvider<ImageGen>;
  tts?: ManagedProvider<TTS>;
}

export const ELEVENLABS_FLASH_MODEL = "eleven_flash_v2_5";

const textPrice: Price = (u) => costOf("geminiText", { input: u.inputTokens, output: u.outputTokens });
const falPrice: Price = (u) => costOf("falImage", { images: u.images });
const geminiImagePrice: Price = (u) => costOf("geminiImage", { images: u.images });
const voicePrice: Price = (u) => costOf("elevenlabs", { chars: u.chars });

/**
 * ShortLoop AI is off unless MANAGED_AI_ENABLED=1 (kill switch). Keys: MANAGED_GEMINI_API_KEY (scripts and premium
 * images), MANAGED_FAL_KEY (images), MANAGED_ELEVENLABS_API_KEY (voices). Each job is offered only when its key
 * is set. With `fake`, offline fakes stand in, priced like the real providers so metering can be tested.
 */
export function managedProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { fake?: boolean; fetch?: typeof fetch } = {},
): ManagedProviders {
  if (env.MANAGED_AI_ENABLED !== "1") return {};
  const f = opts.fetch ?? fetch;
  if (opts.fake) {
    return {
      llm: { provider: new FakeScriptLLM(), price: textPrice },
      image: { provider: new FakeImage(), price: falPrice },
      premiumImage: { provider: new FakeImage(), price: geminiImagePrice },
      tts: { provider: new FakeTTS(), price: voicePrice },
    };
  }
  const gemini = env.MANAGED_GEMINI_API_KEY;
  const fal = env.MANAGED_FAL_KEY;
  const eleven = env.MANAGED_ELEVENLABS_API_KEY;
  return {
    llm: gemini
      ? { provider: new GeminiLLM(gemini, env.MANAGED_LLM_MODEL || undefined, f), price: textPrice }
      : undefined,
    image: fal ? { provider: new FalImage(fal, undefined, f), price: falPrice } : undefined,
    premiumImage: gemini
      ? {
          provider: new GeminiImage(gemini, env.MANAGED_IMAGE_MODEL || undefined, f),
          price: geminiImagePrice,
        }
      : undefined,
    tts: eleven
      ? { provider: new ElevenLabsTTS(eleven, ELEVENLABS_FLASH_MODEL, f), price: voicePrice }
      : undefined,
  };
}

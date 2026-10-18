import { imageFromEnv, PollinationsImage, type ImageGen } from "../image";
import { llmFromEnv, type LLM } from "../llm";
import { stockFromEnv, type StockProvider } from "../stock";
import { EdgeTTS, ttsFromEnv, type TTS } from "../tts";

export interface PlatformProviders {
  llm?: LLM;
  tts: TTS;
  image: ImageGen;
  stock: StockProvider[];
  /** True when the operator's paid keys (env) are shared with every user. */
  sharedKeys: boolean;
}

/**
 * What every user gets without their own keys. By default only free providers (Edge voices, Pollinations
 * images), so the operator never pays for users' AI usage. Set SHORTLOOP_SHARED_KEYS=1 to also share the
 * operator's env keys (ANTHROPIC_API_KEY, PEXELS_API_KEY, ...) with everyone, e.g. for a private beta.
 */
export function platformProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): PlatformProviders {
  if (env.SHORTLOOP_SHARED_KEYS !== "1") {
    return { tts: new EdgeTTS(), image: new PollinationsImage(), stock: [], sharedKeys: false };
  }
  let llm: LLM | undefined;
  try {
    llm = llmFromEnv(env);
  } catch {
    llm = undefined;
  }
  return { llm, tts: ttsFromEnv(env), image: imageFromEnv(env), stock: stockFromEnv(env), sharedKeys: true };
}

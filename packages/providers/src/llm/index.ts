import { AnthropicLLM } from "./anthropic";
import type { LLM } from "./llm";
import { OpenAILLM } from "./openai";

export { extractJson, JSON_ONLY, LLMOutputError, parseReply, type JsonRequest, type LLM } from "./llm";
export { AnthropicLLM } from "./anthropic";
export { OpenAILLM } from "./openai";
export { FakeLLM } from "./fake";

/** LLM_PROVIDER=anthropic|openai (default: whichever key is set, Anthropic first). */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LLM {
  const provider =
    env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : "");
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY)
    return new AnthropicLLM(env.ANTHROPIC_API_KEY, env.LLM_MODEL);
  if (provider === "openai" && env.OPENAI_API_KEY)
    return new OpenAILLM(env.OPENAI_API_KEY, env.LLM_MODEL, env.OPENAI_BASE_URL);
  throw new Error(
    "No LLM configured: set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL).",
  );
}

import OpenAI from "openai";
import { DEFAULT_MODELS } from "@shortloop/contracts";
import { JSON_ONLY, parseReply, type JsonRequest, type LLM } from "./llm";

/** OpenAI or any OpenAI-compatible endpoint (set baseURL). */
export class OpenAILLM implements LLM {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_MODELS.openai.text,
    baseURL?: string,
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens ?? 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${req.system}\n\n${JSON_ONLY}` },
        { role: "user", content: req.prompt },
      ],
    });
    return parseReply(res.choices[0]?.message.content ?? "", req.schema);
  }
}

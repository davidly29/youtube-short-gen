import Anthropic from "@anthropic-ai/sdk";
import { JSON_ONLY, parseReply, type JsonRequest, type LLM } from "./llm";

export class AnthropicLLM implements LLM {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model = "claude-sonnet-5-5",
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 2000,
      temperature: req.temperature ?? 0.8,
      system: `${req.system}\n\n${JSON_ONLY}`,
      messages: [{ role: "user", content: req.prompt }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return parseReply(text, req.schema);
  }
}

import { parseReply, type JsonRequest, type LLM } from "./llm";

/** Deterministic LLM for tests: a function maps each request to raw reply text. */
export class FakeLLM implements LLM {
  readonly provider = "fake";
  readonly model = "fake-1";
  readonly calls: JsonRequest<unknown>[] = [];

  constructor(private readonly reply: (req: JsonRequest<unknown>, callIndex: number) => string) {}

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const i = this.calls.length;
    this.calls.push(req as JsonRequest<unknown>);
    return parseReply(this.reply(req as JsonRequest<unknown>, i), req.schema);
  }
}

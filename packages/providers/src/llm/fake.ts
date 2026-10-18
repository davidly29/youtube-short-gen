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

/**
 * Writes a well-formed script for any topic, sized to the requested length. For e2e tests and demos
 * without an API key (set LLM_PROVIDER=fake). Not used in production.
 */
export class FakeScriptLLM extends FakeLLM {
  constructor() {
    super((req) => {
      const target = Number(/must be (\d+) ±10%/.exec(req.system)?.[1] ?? 78);
      const topic = /Topic: (.*)/.exec(req.prompt)?.[1]?.trim() ?? "this topic";
      const hook = `Here is the surprising truth about ${topic}.`;
      const hookWords = hook.split(/\s+/).length;
      const cta = "Follow for more.";
      const sentences = [
        "Most people never think about it",
        "but scientists have studied it for years",
        "and the answer is stranger than you expect",
        "it starts with something small and simple",
        "then it grows into something remarkable",
        "which changes how we see the whole story",
      ];
      const ctaWords = cta.split(/\s+/).length;
      const body = target - ctaWords; // spoken words in the beats, hook included
      const fill = (i: number, n: number) => {
        const words = sentences[i % sentences.length]?.split(" ") ?? ["more"];
        return Array.from({ length: n }, (_, k) => words[k % words.length]).join(" ");
      };
      const sizes = Array.from({ length: 5 }, () => Math.max(3, Math.floor(body / 5)));
      sizes[0] = Math.max(sizes[0] ?? 3, hookWords + 1);
      sizes[4] = Math.max(3, body - sizes.slice(0, 4).reduce((a, b) => a + b, 0));
      const beats = sizes.map((n, i) => {
        const text = i === 0 ? `${hook} ${fill(i, n - hookWords)}.` : `${fill(i, n)}.`;
        return {
          text: i === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1),
          visualQuery: `${topic}, scene ${i + 1}`,
        };
      });
      return JSON.stringify({ title: topic.charAt(0).toUpperCase() + topic.slice(1), hook, beats, cta });
    });
  }
}

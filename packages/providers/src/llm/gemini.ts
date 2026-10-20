import { DEFAULT_MODELS, type ProviderCapability } from "@shortloop/contracts";
import { httpError, ProviderError } from "../errors";
import { JSON_ONLY, parseReply, type JsonRequest, type LLM } from "./llm";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
/** Default text model; users can override it in Settings when Google renames models. */
export const GEMINI_TEXT_MODEL = DEFAULT_MODELS.gemini.text;

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function geminiGenerate(
  fetchImpl: typeof fetch,
  apiKey: string,
  model: string,
  body: unknown,
  capability: ProviderCapability = "llm",
): Promise<GenerateContentResponse> {
  const res = await fetchImpl(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    // Key in a header, never in the URL, so it can't leak into logs.
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError("gemini", capability, res);
  const data = (await res.json().catch(() => ({}))) as GenerateContentResponse;
  if (data.promptFeedback?.blockReason)
    throw new ProviderError({
      kind: "blocked",
      provider: "gemini",
      capability,
      detail: data.promptFeedback.blockReason,
    });
  return data;
}

/** Google Gemini (AI Studio API key) via generateContent with JSON output. */
export class GeminiLLM implements LLM {
  readonly provider = "gemini";

  constructor(
    private readonly apiKey: string,
    readonly model: string = GEMINI_TEXT_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const data = await geminiGenerate(this.fetchImpl, this.apiKey, this.model, {
      systemInstruction: { parts: [{ text: `${req.system}\n\n${JSON_ONLY}` }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: req.temperature ?? 0.8,
        maxOutputTokens: req.maxTokens ?? 2000,
      },
    });
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseReply(text, req.schema);
  }
}

import type { ZodType } from "zod";

export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
}

/** Large language model that returns schema-validated JSON. */
export interface LLM {
  readonly provider: string;
  readonly model: string;
  /** Returns the parsed JSON or throws (`LLMOutputError`) when the reply doesn't match the schema. */
  json<T>(req: JsonRequest<T>): Promise<T>;
}

export class LLMOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

/** Pull the first JSON object or array out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new LLMOutputError("no JSON in model reply", text);
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end < start) throw new LLMOutputError("unterminated JSON in model reply", text);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new LLMOutputError(`invalid JSON: ${(e as Error).message}`, text);
  }
}

export function parseReply<T>(text: string, schema: ZodType<T>): T {
  const res = schema.safeParse(extractJson(text));
  if (!res.success) throw new LLMOutputError(`reply failed schema: ${res.error.message}`, text);
  return res.data;
}

export const JSON_ONLY = "Reply with a single JSON value only. No prose, no markdown fences.";

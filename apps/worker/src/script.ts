import { schema, type Db } from "@shortloop/db";
import {
  generateScript,
  policyCheck,
  policyCheckScript,
  type JobHandler,
  type ScriptRequest,
} from "@shortloop/pipeline";
import type { LLM } from "@shortloop/providers";

export class PolicyBlockedError extends Error {}

export type ScriptInput = Omit<ScriptRequest, "projectId"> & { projectId: string };

/** Topic -> policy check -> original script -> policy check -> saved `scripts` row. */
export function scriptHandler(db: Db, llm: LLM): JobHandler {
  return async ({ job, onProgress }) => {
    const input = job.input as unknown as ScriptInput;
    const topicCheck = policyCheck([input.topic, input.angle ?? ""].join("\n"));
    if (!topicCheck.allow) throw new PolicyBlockedError(topicCheck.reasons.map((r) => r.message).join(" "));
    await onProgress(0.1);
    const script = await generateScript(llm, input);
    const check = policyCheckScript(script);
    if (!check.allow) throw new PolicyBlockedError(check.reasons.map((r) => r.message).join(" "));
    await onProgress(0.9);
    await db.insert(schema.scripts).values({
      id: script.id,
      projectId: script.projectId,
      title: script.title,
      hook: script.hook,
      beats: script.beats,
      cta: script.cta,
      language: script.language,
      wordCount: script.wordCount,
    });
    return { scriptId: script.id, wordCount: script.wordCount };
  };
}

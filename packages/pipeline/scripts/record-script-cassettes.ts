/**
 * Records the script-generation cassettes replayed by `src/script.cassette.test.ts`.
 *
 *   pnpm -F pipeline record:script --fake   # deterministic recordings through FakeScriptLLM (what CI ships with)
 *   pnpm -F pipeline record:script          # real recordings through llmFromEnv()
 *
 * Recording real cassettes (owner, needs your own key; never run in CI):
 *   1. export ANTHROPIC_API_KEY=... (or OPENAI_API_KEY=..., optionally LLM_PROVIDER / LLM_MODEL)
 *   2. pnpm -F pipeline record:script
 *   3. pnpm -F pipeline test script   # replays the new recordings with the network disabled
 *   4. commit packages/pipeline/test/cassettes/script/*.json
 * The old cassettes are deleted first. Only the request text and the parsed reply are written; a recording
 * that matches a secret pattern is refused. A topic whose real reply fails the quality checks is reported and
 * the run exits non-zero, so you can retry or adjust the prompt before committing.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeScriptLLM, llmFromEnv, RecordingLLM } from "@shortloop/providers";
import { generateScript } from "../src/script";
import { SCRIPT_FIXTURE_TOPICS, scriptFixtureRequest } from "../src/script.fixtures";

export const CASSETTE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../test/cassettes/script");

async function main(): Promise<void> {
  const fake = process.argv.includes("--fake");
  const inner = fake ? new FakeScriptLLM() : llmFromEnv();
  for (const f of readdirSync(CASSETTE_DIR).filter((n) => n.endsWith(".json"))) rmSync(join(CASSETTE_DIR, f));
  const recorder = new RecordingLLM(inner, CASSETTE_DIR);
  let failed = 0;
  for (const topic of SCRIPT_FIXTURE_TOPICS) {
    try {
      const s = await generateScript(recorder, scriptFixtureRequest(topic));
      console.log(`ok   ${topic} (${s.wordCount} words, ${s.beats.length} beats)`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${topic}: ${(e as Error).message}`);
    }
  }
  console.log(
    `${recorder.recorded.length} cassette(s) written to ${CASSETTE_DIR} with ${inner.provider}/${inner.model}`,
  );
  // Match the repo's Prettier style so the recordings pass `pnpm format:check` as committed.
  execFileSync("pnpm", ["exec", "prettier", "--write", "--log-level", "warn", CASSETTE_DIR], {
    stdio: "inherit",
  });
  if (failed) process.exitCode = 1;
}

await main();

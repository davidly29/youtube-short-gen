import type { ScriptRequest } from "./script";

/** The 20 fixture topics shared by the fake-LLM script test, the cassette replay test and `record:script`. */
export const SCRIPT_FIXTURE_TOPICS = [
  "why octopuses have three hearts",
  "how black holes evaporate",
  "the history of the fork",
  "why cats purr",
  "how noise-cancelling headphones work",
  "the Great Emu War",
  "why the sky is blue",
  "how bees make honey",
  "the first computer bug",
  "why we yawn",
  "how GPS knows where you are",
  "the tallest tree on Earth",
  "why onions make you cry",
  "how airplanes stay up",
  "the invention of the sandwich",
  "why ice floats",
  "how chameleons change colour",
  "the deepest point in the ocean",
  "why leaves change colour",
  "how vaccines train the immune system",
] as const;

/** The request each fixture topic is recorded and replayed with. Changing it means re-recording. */
export function scriptFixtureRequest(topic: string): ScriptRequest {
  return { projectId: "prj_fixture", topic, targetSeconds: 45, tone: "curious", language: "en" };
}

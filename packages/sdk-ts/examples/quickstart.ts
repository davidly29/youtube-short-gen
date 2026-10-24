/**
 * ShortLoop quick-start: make a Short from a topic, approve it and publish it.
 *
 *   SHORTLOOP_API_URL=https://<app>/api/v1 SHORTLOOP_API_KEY=sl_... pnpm -F sdk-ts quickstart "why octopuses have three hearts"
 *
 * It publishes as `private` unless you pass SHORTLOOP_PRIVACY=public, so a test run never goes live by accident.
 */
import { ShortLoop } from "../src";

export interface QuickstartResult {
  projectId: string;
  videoUrl?: string;
  youtubeUrl?: string;
  publishStatus: string;
  creditsBefore: number;
  creditsAfter: number;
}

export async function quickstart(
  sl: ShortLoop,
  opts: { topic: string; privacy?: "public" | "unlisted" | "private"; log?: (line: string) => void } = {
    topic: "why octopuses have three hearts",
  },
): Promise<QuickstartResult> {
  const log = opts.log ?? (() => {});

  const before = await sl.getBalance();
  log(`credits: ${before.shorts} Shorts`);

  const created = await sl.createShort({ topic: opts.topic, length_seconds: 30 });
  log(`making ${created.project_id} (job ${created.job_id})`);

  const made = await sl.waitForJob(created.job_id);
  log(`rendered: ${made.video_url ?? "(no link)"}`);
  if (made.publishable === false) {
    throw new Error(`Not publishable: ${(made.problems ?? []).join("; ")}`);
  }

  // A person should watch the video before this in real use: approval is the human-in-the-loop step.
  await sl.approveShort(created.project_id);
  const pub = await sl.publishShort(created.project_id, { privacy: opts.privacy ?? "private" });
  const published = await sl.waitForJob(pub.job_id);
  log(`publish ${published.status}: ${published.url ?? ""}`);

  const after = await sl.getBalance();
  return {
    projectId: created.project_id,
    videoUrl: made.video_url,
    youtubeUrl: published.url,
    publishStatus: published.status,
    creditsBefore: before.shorts,
    creditsAfter: after.shorts,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const privacy = (process.env.SHORTLOOP_PRIVACY ?? "private") as "public" | "unlisted" | "private";
  const result = await quickstart(new ShortLoop(), {
    topic: process.argv[2] ?? "why octopuses have three hearts",
    privacy,
    log: console.log,
  });
  console.log(JSON.stringify(result, null, 2));
}

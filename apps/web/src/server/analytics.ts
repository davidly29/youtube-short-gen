import "server-only";
import type { ShortPerformance } from "@shortloop/contracts";
import { channelsMissingAnalytics, refreshAnalytics, shortPerformance } from "@shortloop/worker";
import { runtime } from "./runtime";

export interface Performance {
  shorts: ShortPerformance[];
  /** YouTube channels connected before stats were added: reconnect to share them. */
  reconnect: { id: string; title: string }[];
}

/** The dashboard card (E10-01): views and retention per published Short. */
export async function performanceFor(userId: string): Promise<Performance> {
  const { db } = await runtime();
  const [shorts, reconnect] = await Promise.all([
    shortPerformance(db, userId),
    channelsMissingAnalytics(db, userId),
  ]);
  return { shorts, reconnect };
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/**
 * "Refresh stats": enqueue an ingest for each of the user's channels (at most once an hour each). In the
 * all-in-one runtime the jobs run in this process, so wait briefly for them; with a separate worker they
 * finish in the background. Returns whether every job has finished.
 */
export async function refreshStats(userId: string, waitMs = 15_000): Promise<{ done: boolean }> {
  const rt = await runtime();
  const jobs = await refreshAnalytics(rt.jobs, rt.db, userId);
  const deadline = Date.now() + (rt.mode === "all-in-one" ? waitMs : 0);
  for (;;) {
    const states = await Promise.all(jobs.map((j) => rt.jobs.get(j.id)));
    if (states.every((s) => s && TERMINAL.has(s.status))) return { done: true };
    if (Date.now() >= deadline) return { done: false };
    await new Promise((r) => setTimeout(r, 250));
  }
}

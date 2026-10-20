import { randomUUID } from "node:crypto";
import { Brief, DEFAULT_NICHES, type Job } from "@shortloop/contracts";
import { and, eq, gte, lte, ne, schema, toTrendSignal, type Db } from "@shortloop/db";
import {
  BASELINE_DAYS,
  BRIEF_EXCLUDE_DAYS,
  buildBrief,
  clusterTopics,
  type JobHandler,
  type JobService,
} from "@shortloop/pipeline";
import type { LLM } from "@shortloop/providers";

const DAY_MS = 86_400_000;
/** Briefs are built once a day from this UTC hour. Per-user local times belong to the digest (#79). */
export const BRIEF_HOUR_UTC = 5;

/** A `brief` job rides the `trends` queue; `kind` tells it apart from hourly collection. */
export interface BriefJobInput {
  kind: "brief";
  channelId: string;
  /** `YYYY-MM-DD` (UTC). */
  date: string;
}

export const isBriefInput = (input: Record<string, unknown>): boolean => input.kind === "brief";
export const briefJobKey = (channelId: string, date: string) => `brief:${channelId}:${date}`;

export interface BriefHandlerOptions {
  /** The channel owner's own LLM (BYOK) or undefined; never a platform-paid model. */
  llmFor?: (ownerId: string) => Promise<LLM | undefined>;
  now?: () => Date;
}

/**
 * Build and store one channel's daily brief (E3-03): last 8 days of signals → `clusterTopics` for the
 * channel's niche → drop topics its owner made a project from in the last 14 days → `buildBrief`
 * (owner's LLM or the free template) → upsert by (channel, date). Costs no credits.
 */
export function briefHandler(db: Db, opts: BriefHandlerOptions = {}): JobHandler {
  return async ({ job, onProgress }) => {
    const input = job.input as Partial<BriefJobInput>;
    const channelId = String(input.channelId ?? "");
    const date = String(input.date ?? "");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
    if (!channel) return { skipped: "channel not found", channelId };
    const niche = DEFAULT_NICHES.find((n) => n.id === channel.nicheId);
    if (!niche) return { skipped: channel.nicheId ? "unknown niche" : "no niche", channelId };

    const now = opts.now?.() ?? new Date();
    const from = new Date(now.getTime() - (BASELINE_DAYS + 1) * DAY_MS).toISOString();
    const rows = await db
      .select()
      .from(schema.trendSignals)
      .where(
        and(
          gte(schema.trendSignals.observedAt, from),
          lte(schema.trendSignals.observedAt, now.toISOString()),
        ),
      );
    const topics = clusterTopics(rows.map(toTrendSignal), niche, { now, seed: 0 });
    await onProgress(0.4);

    const since = new Date(now.getTime() - BRIEF_EXCLUDE_DAYS * DAY_MS).toISOString();
    const recent = await db
      .select({ topicId: schema.projects.topicId })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.ownerId, channel.ownerId),
          gte(schema.projects.createdAt, since),
          ne(schema.projects.topicId, ""), // also drops NULLs (projects not made from a topic)
        ),
      );
    const recentTopicIds = recent.flatMap((r) => (r.topicId ? [r.topicId] : []));

    let llm: LLM | undefined;
    try {
      llm = await opts.llmFor?.(channel.ownerId);
    } catch (e) {
      console.warn(`brief ${channelId}: owner's keys unavailable: ${e instanceof Error ? e.message : e}`);
    }
    const built = await buildBrief({ niche, topics, recentTopicIds, date, llm });
    await onProgress(0.9);

    const brief = Brief.parse({ ...built, id: `brief_${randomUUID()}`, channelId });
    const [stored] = await db
      .insert(schema.briefs)
      .values({
        id: brief.id,
        channelId,
        date: brief.date,
        items: brief.items,
        generatedWith: brief.generatedWith,
        partial: brief.partial,
      })
      .onConflictDoUpdate({
        target: [schema.briefs.channelId, schema.briefs.date],
        set: {
          items: brief.items,
          generatedWith: brief.generatedWith,
          partial: brief.partial,
          updatedAt: now.toISOString(),
        },
      })
      .returning();
    return {
      briefId: stored?.id ?? brief.id,
      channelId,
      date,
      items: brief.items.length,
      topics: topics.length,
      generatedWith: brief.generatedWith,
      partial: brief.partial,
    };
  };
}

/**
 * Enqueue today's brief for every channel with a niche, once `BRIEF_HOUR_UTC` has passed. Idempotent
 * per channel and day (`brief:<channelId>:<date>`), so calling it every few minutes builds one brief
 * a day. Jobs belong to the channel owner (their LLM key) and cost no credits.
 */
export async function scheduleBriefs(jobs: JobService, db: Db, now: Date = new Date()): Promise<Job[]> {
  if (now.getUTCHours() < BRIEF_HOUR_UTC) return [];
  const date = now.toISOString().slice(0, 10);
  const channels = await db
    .select({ id: schema.channels.id, ownerId: schema.channels.ownerId, nicheId: schema.channels.nicheId })
    .from(schema.channels);
  const out: Job[] = [];
  for (const c of channels) {
    if (!c.nicheId) continue;
    const input: BriefJobInput = { kind: "brief", channelId: c.id, date };
    out.push(
      await jobs.enqueue(
        "trends",
        { ...input },
        { idempotencyKey: briefJobKey(c.id, date), ownerId: c.ownerId, costCredits: 0 },
      ),
    );
  }
  return out;
}

/** Repeatable daily brief: checks every `everyMs` (default 5 min). Returns a stop function. */
export function startBriefSchedule(
  jobs: JobService,
  db: Db,
  opts: { everyMs?: number; now?: () => Date } = {},
): () => void {
  const tick = () =>
    void scheduleBriefs(jobs, db, opts.now?.() ?? new Date()).catch((e) =>
      console.error("brief schedule failed", e),
    );
  tick();
  const timer = setInterval(tick, opts.everyMs ?? 5 * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

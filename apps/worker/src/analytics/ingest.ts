import type { Job, ShortPerformance } from "@shortloop/contracts";
import { and, desc, eq, gte, inArray, lte, ne, schema, sql, type Db } from "@shortloop/db";
import { LIVE_PUBLISH_STATUSES, syncFeatures, type JobHandler, type JobService } from "@shortloop/pipeline";
import {
  AnalyticsScopeMissing,
  hasAnalyticsScope,
  ReconnectRequired,
  type SecretBox,
  type YouTubeAnalyticsClient,
  type YouTubeClient,
} from "@shortloop/providers";
import { channelAccessToken } from "../channels";

const DAY_MS = 86_400_000;
/** On a Short's first ingest we read this many days back (or from its publish day if later). */
export const ANALYTICS_BACKFILL_DAYS = 28;
/** Later runs re-read the last few days too: YouTube revises recent numbers for ~48 h. */
export const ANALYTICS_REFRESH_DAYS = 3;
/** Shorts older than this stop being refreshed (their stored history stays). */
export const ANALYTICS_TRACK_DAYS = 90;

export interface AnalyticsJobInput {
  channelId: string;
  /** Why it ran: the daily schedule, a channel (re)connect, or the creator's "Refresh" button. */
  reason: "daily" | "connect" | "refresh";
}

export const analyticsJobKey = (channelId: string, bucket: string) => `analytics:${channelId}:${bucket}`;

export interface AnalyticsDeps {
  db: Db;
  box?: SecretBox;
  youtube?: YouTubeClient;
  analytics?: YouTubeAnalyticsClient;
  now?: () => Date;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => day(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS));

/** The date range to read for one Short: a 28-day backfill first, then a gap-filling refresh. */
export function metricsWindow(
  publishedAt: string,
  latestStored: string | undefined,
  today: string,
): { startDate: string; endDate: string } | undefined {
  const published = day(new Date(publishedAt));
  const floor = addDays(today, -(ANALYTICS_BACKFILL_DAYS - 1));
  let start = floor;
  if (latestStored) {
    const next = addDays(latestStored, 1);
    const refresh = addDays(today, -(ANALYTICS_REFRESH_DAYS - 1));
    start = next < refresh ? next : refresh;
  }
  if (start < floor) start = floor;
  if (start < published) start = published;
  return start > today ? undefined : { startDate: start, endDate: today };
}

/**
 * One channel's performance ingest (E10-01): give every live Short a feature row (E10-02), then, for a
 * YouTube channel whose grant includes analytics, read each Short's daily numbers from the YouTube
 * Analytics API and upsert them by (publish, day). Re-running a day changes nothing but the numbers.
 * Costs no credits and uses no AI keys. A channel that must reconnect is skipped, not failed.
 */
export function analyticsHandler(deps: AnalyticsDeps): JobHandler {
  return async ({ job, onProgress }) => {
    const { db } = deps;
    const input = job.input as Partial<AnalyticsJobInput>;
    const channelId = String(input.channelId ?? "");
    const now = deps.now?.() ?? new Date();
    const ch = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) });
    if (!ch || ch.status === "disconnected") return { skipped: "channel not connected", channelId };

    const features = await syncFeatures(db, { channelId, now });
    if (ch.platform !== "youtube") return { skipped: `no ${ch.platform} insights yet`, channelId, features };
    if (!deps.youtube || !deps.analytics || !deps.box)
      return { skipped: "YouTube isn't set up on this server", channelId, features };
    if (!hasAnalyticsScope(ch.scopes))
      return { skipped: "reconnect the channel to share YouTube stats", channelId, features };

    let token: string;
    try {
      token = await channelAccessToken(db, deps.box, deps.youtube, channelId);
    } catch (e) {
      if (e instanceof ReconnectRequired)
        return { skipped: "channel needs reconnecting", channelId, features };
      throw e;
    }

    const since = new Date(now.getTime() - ANALYTICS_TRACK_DAYS * DAY_MS).toISOString();
    const shorts = await db
      .select({
        id: schema.publishRecords.id,
        externalId: schema.publishRecords.externalId,
        publishedAt: schema.publishRecords.publishedAt,
      })
      .from(schema.publishRecords)
      .where(
        and(
          eq(schema.publishRecords.channelId, channelId),
          inArray(schema.publishRecords.status, [...LIVE_PUBLISH_STATUSES]),
          ne(schema.publishRecords.externalId, ""), // also drops NULLs
          gte(schema.publishRecords.publishedAt, since),
          lte(schema.publishRecords.publishedAt, now.toISOString()),
        ),
      );
    const latest = shorts.length
      ? await db
          .select({
            publishId: schema.shortMetrics.publishId,
            date: sql<string>`max(${schema.shortMetrics.date})`,
          })
          .from(schema.shortMetrics)
          .where(
            inArray(
              schema.shortMetrics.publishId,
              shorts.map((s) => s.id),
            ),
          )
          .groupBy(schema.shortMetrics.publishId)
      : [];
    const latestBy = new Map(latest.map((l) => [l.publishId, l.date]));

    const today = day(now);
    let rows = 0;
    let backfilled = 0;
    for (const [i, s] of shorts.entries()) {
      if (!s.publishedAt || !s.externalId) continue;
      const win = metricsWindow(s.publishedAt, latestBy.get(s.id), today);
      if (!win) continue;
      let daily;
      try {
        daily = await deps.analytics.videoDaily({ accessToken: token, videoId: s.externalId, ...win });
      } catch (e) {
        if (e instanceof AnalyticsScopeMissing)
          return { skipped: "reconnect the channel to share YouTube stats", channelId, features, rows };
        throw e;
      }
      if (!latestBy.has(s.id)) backfilled += 1;
      if (daily.length) {
        const values = daily.map((d) => ({
          publishId: s.id,
          date: d.date,
          views: d.views,
          avgViewPct: d.avgViewPct,
          likes: d.likes,
          comments: d.comments,
          subsGained: d.subsGained,
          updatedAt: now.toISOString(),
        }));
        await db
          .insert(schema.shortMetrics)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.shortMetrics.publishId, schema.shortMetrics.date],
            set: {
              views: sql`excluded.views`,
              avgViewPct: sql`excluded.avg_view_pct`,
              likes: sql`excluded.likes`,
              comments: sql`excluded.comments`,
              subsGained: sql`excluded.subs_gained`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        rows += values.length;
      }
      await onProgress((i + 1) / shorts.length);
    }
    return { channelId, shorts: shorts.length, rows, backfilled, features };
  };
}

/** Enqueue one channel's ingest. Free; owned by the channel's owner. */
export function enqueueAnalytics(
  jobs: JobService,
  channel: { id: string; ownerId: string },
  reason: AnalyticsJobInput["reason"],
  bucket: string,
): Promise<Job> {
  const input: AnalyticsJobInput = { channelId: channel.id, reason };
  return jobs.enqueue(
    "analytics",
    { ...input },
    { idempotencyKey: analyticsJobKey(channel.id, bucket), ownerId: channel.ownerId, costCredits: 0 },
  );
}

/**
 * Today's ingest for every connected channel: idempotent per channel and UTC day
 * (`analytics:<channelId>:<date>`), so calling it every few minutes runs each channel once a day.
 */
export async function scheduleAnalytics(jobs: JobService, db: Db, now: Date = new Date()): Promise<Job[]> {
  const date = day(now);
  const channels = await db
    .select({ id: schema.channels.id, ownerId: schema.channels.ownerId })
    .from(schema.channels)
    .where(eq(schema.channels.status, "connected"));
  const out: Job[] = [];
  for (const c of channels) out.push(await enqueueAnalytics(jobs, c, "daily", date));
  return out;
}

/** Repeatable daily ingest: checks every `everyMs` (default 5 min). Returns a stop function. */
export function startAnalyticsSchedule(
  jobs: JobService,
  db: Db,
  opts: { everyMs?: number; now?: () => Date } = {},
): () => void {
  const tick = () =>
    void scheduleAnalytics(jobs, db, opts.now?.() ?? new Date()).catch((e) =>
      console.error("analytics schedule failed", e),
    );
  tick();
  const timer = setInterval(tick, opts.everyMs ?? 5 * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * The creator's "Refresh stats": one ingest per connected channel they own, at most once an hour per
 * channel (`analytics:<channelId>:<YYYY-MM-DDTHH>`).
 */
export async function refreshAnalytics(
  jobs: JobService,
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<Job[]> {
  const channels = await db
    .select({ id: schema.channels.id, ownerId: schema.channels.ownerId })
    .from(schema.channels)
    .where(and(eq(schema.channels.ownerId, ownerId), eq(schema.channels.status, "connected")));
  const hour = now.toISOString().slice(0, 13);
  const out: Job[] = [];
  for (const c of channels) out.push(await enqueueAnalytics(jobs, c, "refresh", hour));
  return out;
}

/**
 * The dashboard card: each of the owner's live Shorts with its totals over the stored days (views summed,
 * retention weighted by views), most viewed first, newest first among equals.
 */
export async function shortPerformance(db: Db, ownerId: string, limit = 20): Promise<ShortPerformance[]> {
  const rows = await db
    .select({
      publishId: schema.publishRecords.id,
      projectId: schema.publishRecords.projectId,
      request: schema.publishRecords.request,
      url: schema.publishRecords.url,
      publishedAt: schema.publishRecords.publishedAt,
      channelTitle: schema.channels.title,
      days: sql<number>`count(${schema.shortMetrics.date})::int`,
      views: sql<number>`coalesce(sum(${schema.shortMetrics.views}), 0)::int`,
      weighted: sql<number>`coalesce(sum(${schema.shortMetrics.views} * ${schema.shortMetrics.avgViewPct}), 0)::float8`,
      likes: sql<number>`coalesce(sum(${schema.shortMetrics.likes}), 0)::int`,
      comments: sql<number>`coalesce(sum(${schema.shortMetrics.comments}), 0)::int`,
      subs: sql<number>`coalesce(sum(${schema.shortMetrics.subsGained}), 0)::int`,
    })
    .from(schema.publishRecords)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.publishRecords.channelId))
    .leftJoin(schema.shortMetrics, eq(schema.shortMetrics.publishId, schema.publishRecords.id))
    .where(
      and(
        eq(schema.publishRecords.ownerId, ownerId),
        inArray(schema.publishRecords.status, [...LIVE_PUBLISH_STATUSES]),
      ),
    )
    .groupBy(schema.publishRecords.id, schema.channels.title)
    .orderBy(
      desc(sql`coalesce(sum(${schema.shortMetrics.views}), 0)`),
      desc(schema.publishRecords.publishedAt),
    )
    .limit(limit);
  return rows.map((r) => {
    const views = Number(r.views);
    return {
      publishId: r.publishId,
      projectId: r.projectId ?? undefined,
      title: r.request.title,
      channelTitle: r.channelTitle,
      url: r.url ?? undefined,
      publishedAt: r.publishedAt ?? undefined,
      days: Number(r.days),
      views,
      avgViewPct: views > 0 ? Math.round((Number(r.weighted) / views) * 10) / 10 : undefined,
      likes: Number(r.likes),
      comments: Number(r.comments),
      subsGained: Number(r.subs),
    };
  });
}

/** Connected YouTube channels of this owner that were connected before analytics and must reconnect for stats. */
export async function channelsMissingAnalytics(db: Db, ownerId: string) {
  const rows = await db
    .select({ id: schema.channels.id, title: schema.channels.title, scopes: schema.channels.scopes })
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.ownerId, ownerId),
        eq(schema.channels.platform, "youtube"),
        ne(schema.channels.status, "disconnected"),
      ),
    );
  return rows.filter((r) => !hasAnalyticsScope(r.scopes)).map(({ id, title }) => ({ id, title }));
}

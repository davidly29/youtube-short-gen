import {
  type HookType,
  type FormatSlug,
  FormatSlug as FormatSlugSchema,
  ShortFeatures,
  type VisualMix,
} from "@shortloop/contracts";
import { and, desc, eq, inArray, isNull, lte, or, schema, sql, type Db } from "@shortloop/db";
import { parquetWriteBuffer } from "hyparquet-writer";

/** Publish states whose video is (or will be) on the platform under an external id. */
export const LIVE_PUBLISH_STATUSES = ["published", "scheduled"] as const;

const NUMBER_WORDS = new Set([
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "top",
]);
const QUESTION_WORDS = new Set(["how", "why", "what", "when", "where", "who", "which"]);
const CONTRARIAN =
  /\b(stop|never|myths?|wrong|lies?|lied|actually|nobody|no one|don'?t|isn'?t|aren'?t|truth|mistake|overrated|fake)\b/i;

const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * How a hook opens, first match wins: a question ("…?"), a number or list ("3 …", "Top …"), a how/why
 * statement ("Why the Romans …"), a contrarian claim ("Stop …", "… is a myth"), or a plain statement.
 */
export function hookType(hook: string): HookType {
  const text = hook.trim();
  if (text.endsWith("?")) return "question";
  const first = (wordsOf(text)[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d/.test(first) || NUMBER_WORDS.has(first)) return "number";
  if (QUESTION_WORDS.has(first)) return "how_why";
  if (CONTRARIAN.test(text)) return "contrarian";
  return "statement";
}

/** Everything `featurize` needs about one published Short, gathered by `loadShortFacts`. */
export interface ShortFacts {
  hook: string;
  beats: number;
  durationMs: number;
  captionStyle: string;
  voiceId: string;
  /** Video-track clips with the source of their asset (`upload`, `stock`, `ai_generated`, …). */
  clips: { startMs: number; endMs: number; source: string }[];
  format: FormatSlug | "custom";
  topicVelocity: number | null;
  /** When it went live (ISO). */
  publishedAt: string;
}

/** Share of on-screen time by footage origin; sources that aren't footage (renders, music) don't count. */
export function visualMix(clips: ShortFacts["clips"]): VisualMix {
  const t = { own: 0, stock: 0, ai: 0 };
  for (const c of clips) {
    const ms = Math.max(0, c.endMs - c.startMs);
    if (c.source === "upload" || c.source === "own_channel") t.own += ms;
    else if (c.source === "stock") t.stock += ms;
    else if (c.source === "ai_generated") t.ai += ms;
  }
  const total = t.own + t.stock + t.ai;
  if (total === 0) return { own: 0, stock: 0, ai: 0 };
  const r = (n: number) => Math.round((n / total) * 1000) / 1000;
  return { own: r(t.own), stock: r(t.stock), ai: r(t.ai) };
}

/** Describe one Short by the choices we made (E10-02). Pure. */
export function featurize(f: ShortFacts): ShortFeatures {
  return ShortFeatures.parse({
    hookType: hookType(f.hook),
    hookWords: wordsOf(f.hook).length,
    durationS: Math.round(f.durationMs / 100) / 10,
    beats: f.beats,
    captionStyle: f.captionStyle,
    voiceId: f.voiceId,
    visualMix: visualMix(f.clips),
    format: f.format,
    topicVelocity: f.topicVelocity && f.topicVelocity > 0 ? f.topicVelocity : null,
    postHour: new Date(f.publishedAt).getUTCHours(),
  });
}

export class FeatureError extends Error {}

/**
 * Gather the facts for one publish record: its project's script and timeline, the voice actually used,
 * the clips' asset sources, and the brief item (format, topic velocity) when the Short came from a brief.
 * A publish without a project (or before its script/timeline existed) still gets facts from its request.
 */
export async function loadShortFacts(db: Db, publishId: string): Promise<ShortFacts> {
  const rec = await db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, publishId) });
  if (!rec) throw new FeatureError(`publish ${publishId} not found`);
  const project = rec.projectId
    ? await db.query.projects.findFirst({ where: eq(schema.projects.id, rec.projectId) })
    : undefined;
  const script = project?.scriptId
    ? await db.query.scripts.findFirst({ where: eq(schema.scripts.id, project.scriptId) })
    : undefined;
  const timeline = project?.timelineId
    ? await db.query.timelines.findFirst({ where: eq(schema.timelines.id, project.timelineId) })
    : undefined;

  const assetIds = [
    ...new Set([...(timeline?.video ?? []), ...(timeline?.audio ?? [])].map((c) => c.assetId)),
  ];
  const assets = assetIds.length
    ? await db
        .select({
          id: schema.assets.id,
          kind: schema.assets.kind,
          source: schema.assets.source,
          licence: schema.assets.licence,
        })
        .from(schema.assets)
        .where(inArray(schema.assets.id, assetIds))
    : [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  // The narration is the AI-voiced audio clip; its licence records the voice the TTS actually used.
  const voice = (timeline?.audio ?? [])
    .map((c) => byId.get(c.assetId))
    .find((a) => a?.kind === "audio" && a.source === "ai_generated");

  let format: ShortFacts["format"] = "custom";
  let topicVelocity: number | null = null;
  if (project?.topicId) {
    const [brief] = await db
      .select({ items: schema.briefs.items })
      .from(schema.briefs)
      .innerJoin(schema.channels, eq(schema.channels.id, schema.briefs.channelId))
      .where(
        and(
          eq(schema.channels.ownerId, rec.ownerId),
          sql`${schema.briefs.items} @> ${JSON.stringify([{ topicId: project.topicId }])}::jsonb`,
        ),
      )
      .orderBy(desc(schema.briefs.date))
      .limit(1);
    const item = brief?.items.find((i) => i.topicId === project.topicId);
    if (item) {
      format = FormatSlugSchema.safeParse(item.format).data ?? "custom";
      topicVelocity = item.velocity ?? null;
    }
  }

  return {
    hook: script?.hook ?? rec.request.title,
    beats: script?.beats.length ?? 0,
    durationMs: timeline?.durationMs ?? 0,
    captionStyle: timeline?.captionStyle ?? project?.settings.captionStyle ?? "unknown",
    voiceId: voice?.licence.model ?? project?.settings.voiceId ?? "unknown",
    clips: (timeline?.video ?? []).map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      source: byId.get(c.assetId)?.source ?? "unknown",
    })),
    format,
    topicVelocity,
    publishedAt: rec.publishedAt ?? rec.updatedAt,
  };
}

/** `featurize(shortId)` from the ticket: the features of one published Short (by publish record id). */
export async function featurizeShort(db: Db, publishId: string): Promise<ShortFeatures> {
  return featurize(await loadShortFacts(db, publishId));
}

/** Compute and store (replace) one Short's feature row. */
export async function storeFeatures(db: Db, publishId: string): Promise<ShortFeatures> {
  const rec = await db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, publishId) });
  if (!rec) throw new FeatureError(`publish ${publishId} not found`);
  const features = await featurizeShort(db, publishId);
  const computedAt = new Date().toISOString();
  await db
    .insert(schema.shortFeatures)
    .values({ publishId, ownerId: rec.ownerId, features, computedAt })
    .onConflictDoUpdate({ target: schema.shortFeatures.publishId, set: { features, computedAt } });
  return features;
}

/**
 * Give every live Short (published, or scheduled and past its time) a feature row: the ones that lack
 * one, optionally only for one channel. Returns how many rows were written.
 */
export async function syncFeatures(db: Db, opts: { channelId?: string; now?: Date } = {}): Promise<number> {
  const now = (opts.now ?? new Date()).toISOString();
  const missing = await db
    .select({ id: schema.publishRecords.id })
    .from(schema.publishRecords)
    .leftJoin(schema.shortFeatures, eq(schema.shortFeatures.publishId, schema.publishRecords.id))
    .where(
      and(
        isNull(schema.shortFeatures.publishId),
        inArray(schema.publishRecords.status, [...LIVE_PUBLISH_STATUSES]),
        or(isNull(schema.publishRecords.publishedAt), lte(schema.publishRecords.publishedAt, now)),
        opts.channelId ? eq(schema.publishRecords.channelId, opts.channelId) : undefined,
      ),
    );
  for (const r of missing) await storeFeatures(db, r.id);
  return missing.length;
}

/** One row of the offline-analysis export: who/where/when, the features, and the metric totals. */
export interface FeatureExportRow {
  publishId: string;
  ownerId: string;
  channelId: string;
  platform: string;
  publishedAt: Date | null;
  features: ShortFeatures;
  metricDays: number;
  views: number;
  avgViewPct: number | null;
  likes: number;
  comments: number;
  subsGained: number;
}

/** Feature rows joined with each Short's metric totals (retention weighted by views). */
export async function featureExportRows(
  db: Db,
  opts: { ownerId?: string } = {},
): Promise<FeatureExportRow[]> {
  const rows = await db
    .select({
      publishId: schema.shortFeatures.publishId,
      ownerId: schema.shortFeatures.ownerId,
      features: schema.shortFeatures.features,
      channelId: schema.publishRecords.channelId,
      platform: schema.publishRecords.platform,
      publishedAt: schema.publishRecords.publishedAt,
    })
    .from(schema.shortFeatures)
    .innerJoin(schema.publishRecords, eq(schema.publishRecords.id, schema.shortFeatures.publishId))
    .where(opts.ownerId ? eq(schema.shortFeatures.ownerId, opts.ownerId) : undefined)
    .orderBy(schema.publishRecords.publishedAt, schema.shortFeatures.publishId);
  const ids = rows.map((r) => r.publishId);
  const totals = ids.length
    ? await db
        .select({
          publishId: schema.shortMetrics.publishId,
          days: sql<number>`count(*)::int`,
          views: sql<number>`coalesce(sum(${schema.shortMetrics.views}), 0)::int`,
          weighted: sql<number>`coalesce(sum(${schema.shortMetrics.views} * ${schema.shortMetrics.avgViewPct}), 0)::float8`,
          likes: sql<number>`coalesce(sum(${schema.shortMetrics.likes}), 0)::int`,
          comments: sql<number>`coalesce(sum(${schema.shortMetrics.comments}), 0)::int`,
          subs: sql<number>`coalesce(sum(${schema.shortMetrics.subsGained}), 0)::int`,
        })
        .from(schema.shortMetrics)
        .where(inArray(schema.shortMetrics.publishId, ids))
        .groupBy(schema.shortMetrics.publishId)
    : [];
  const byId = new Map(totals.map((t) => [t.publishId, t]));
  return rows.map((r) => {
    const t = byId.get(r.publishId);
    const views = Number(t?.views ?? 0);
    return {
      publishId: r.publishId,
      ownerId: r.ownerId,
      channelId: r.channelId,
      platform: r.platform,
      publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
      features: r.features,
      metricDays: Number(t?.days ?? 0),
      views,
      avgViewPct: views > 0 ? Math.round((Number(t?.weighted ?? 0) / views) * 100) / 100 : null,
      likes: Number(t?.likes ?? 0),
      comments: Number(t?.comments ?? 0),
      subsGained: Number(t?.subs ?? 0),
    };
  });
}

/** Parquet columns of the export, in order (snake_case for pandas/DuckDB). */
export const FEATURE_EXPORT_COLUMNS = [
  "publish_id",
  "owner_id",
  "channel_id",
  "platform",
  "published_at",
  "hook_type",
  "hook_words",
  "duration_s",
  "beats",
  "caption_style",
  "voice_id",
  "visual_own",
  "visual_stock",
  "visual_ai",
  "format",
  "topic_velocity",
  "post_hour",
  "metric_days",
  "views",
  "avg_view_pct",
  "likes",
  "comments",
  "subs_gained",
] as const;

/** Export the feature store (plus metric totals) as one Parquet file for offline analysis (E10-02). */
export function featuresToParquet(rows: FeatureExportRow[]): Uint8Array {
  const col = <T>(f: (r: FeatureExportRow) => T) => rows.map(f);
  const buf = parquetWriteBuffer({
    columnData: [
      { name: "publish_id", data: col((r) => r.publishId), type: "STRING" },
      { name: "owner_id", data: col((r) => r.ownerId), type: "STRING" },
      { name: "channel_id", data: col((r) => r.channelId), type: "STRING" },
      { name: "platform", data: col((r) => r.platform), type: "STRING" },
      { name: "published_at", data: col((r) => r.publishedAt), type: "TIMESTAMP" },
      { name: "hook_type", data: col((r) => r.features.hookType), type: "STRING" },
      { name: "hook_words", data: col((r) => r.features.hookWords), type: "INT32" },
      { name: "duration_s", data: col((r) => r.features.durationS), type: "DOUBLE" },
      { name: "beats", data: col((r) => r.features.beats), type: "INT32" },
      { name: "caption_style", data: col((r) => r.features.captionStyle), type: "STRING" },
      { name: "voice_id", data: col((r) => r.features.voiceId), type: "STRING" },
      { name: "visual_own", data: col((r) => r.features.visualMix.own), type: "DOUBLE" },
      { name: "visual_stock", data: col((r) => r.features.visualMix.stock), type: "DOUBLE" },
      { name: "visual_ai", data: col((r) => r.features.visualMix.ai), type: "DOUBLE" },
      { name: "format", data: col((r) => r.features.format), type: "STRING" },
      { name: "topic_velocity", data: col((r) => r.features.topicVelocity), type: "DOUBLE" },
      { name: "post_hour", data: col((r) => r.features.postHour), type: "INT32" },
      { name: "metric_days", data: col((r) => r.metricDays), type: "INT32" },
      { name: "views", data: col((r) => r.views), type: "INT32" },
      { name: "avg_view_pct", data: col((r) => r.avgViewPct), type: "DOUBLE" },
      { name: "likes", data: col((r) => r.likes), type: "INT32" },
      { name: "comments", data: col((r) => r.comments), type: "INT32" },
      { name: "subs_gained", data: col((r) => r.subsGained), type: "INT32" },
    ],
  });
  return new Uint8Array(buf);
}

/** `featureExportRows` + `featuresToParquet`. */
export async function exportFeaturesParquet(db: Db, opts: { ownerId?: string } = {}): Promise<Uint8Array> {
  return featuresToParquet(await featureExportRows(db, opts));
}

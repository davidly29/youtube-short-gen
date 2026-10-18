import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AudioClip, Beat, CaptionWord, Clip, Licence, PublishRequest } from "@shortloop/contracts";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const assetKind = pgEnum("asset_kind", ["video", "image", "audio"]);
export const assetSource = pgEnum("asset_source", [
  "upload",
  "own_channel",
  "stock",
  "ai_generated",
  "library_music",
]);
export const platform = pgEnum("platform", ["youtube", "tiktok", "instagram"]);
export const jobType = pgEnum("job_type", ["script", "voice", "visuals", "render", "publish", "trends"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "cancelled"]);
export const publishStatus = pgEnum("publish_status", [
  "queued",
  "uploading",
  "scheduled",
  "scheduled_next_window",
  "published",
  "failed",
]);
/** What a ledger row counts: finished Shorts, or credits for generative video seconds. */
export const creditUnit = pgEnum("credit_unit", ["short", "ai_video_credit"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

/** A connected publishing account (e.g. a YouTube channel). OAuth tokens arrive in E8-01. */
export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    platform: platform("platform").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("channels_platform_external_id").on(t.platform, t.externalId)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("projects_owner").on(t.ownerId)],
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    kind: assetKind("kind").notNull(),
    source: assetSource("source").notNull(),
    licence: jsonb("licence").$type<Licence>().notNull(),
    storageKey: text("storage_key").notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (t) => [index("assets_owner").on(t.ownerId)],
);

export const scripts = pgTable(
  "scripts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    hook: text("hook").notNull(),
    beats: jsonb("beats").$type<Beat[]>().notNull(),
    cta: text("cta").notNull(),
    language: text("language").notNull(),
    wordCount: integer("word_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("scripts_project").on(t.projectId)],
);

export const timelines = pgTable(
  "timelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    fps: integer("fps").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    durationMs: integer("duration_ms").notNull(),
    video: jsonb("video").$type<Clip[]>().notNull(),
    audio: jsonb("audio").$type<AudioClip[]>().notNull(),
    captions: jsonb("captions").$type<CaptionWord[]>().notNull(),
    captionStyle: text("caption_style").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("timelines_project").on(t.projectId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    costCredits: real("cost_credits").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("jobs_owner_status").on(t.ownerId, t.status)],
);

export const publishRecords = pgTable(
  "publish_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    platform: platform("platform").notNull(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id),
    videoAssetId: text("video_asset_id")
      .notNull()
      .references(() => assets.id),
    request: jsonb("request").$type<PublishRequest>().notNull(),
    status: publishStatus("status").notNull().default("queued"),
    externalId: text("external_id"),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("publish_records_owner").on(t.ownerId)],
);

/**
 * Append-only credit ledger. Balance per owner and unit = SUM(delta).
 * A database trigger (migration 0001) rejects UPDATE and DELETE.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    unit: creditUnit("unit").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    jobId: text("job_id").references(() => jobs.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_ledger_owner_unit").on(t.ownerId, t.unit),
    // A job can be charged or refunded at most once per reason.
    uniqueIndex("credit_ledger_job_reason")
      .on(t.jobId, t.reason)
      .where(sql`${t.jobId} is not null`),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
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
  "render",
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
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// ---- Better Auth tables (sessions, linked accounts incl. password hashes, verification tokens)
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
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

export const projectStatus = pgEnum("project_status", [
  "draft",
  "scripting",
  "script_ready",
  "producing",
  "ready",
  "approved",
  "failed",
]);

/** User choices that drive production (voice, captions, look, length). */
export interface ProjectSettings {
  targetSeconds?: 30 | 45 | 60;
  tone?: string;
  language?: string;
  voiceId?: string;
  captionStyle?: string;
  imageStyle?: string;
  angle?: string;
}

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    topic: text("topic"),
    status: projectStatus("status").notNull().default("draft"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    scriptId: text("script_id"),
    timelineId: text("timeline_id"),
    renderAssetId: text("render_asset_id"),
    lastJobId: text("last_job_id"),
    error: text("error"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
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
    title: text("title"),
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

/** Append-only audit trail (overrides, approvals, publishes). Extended by E13-02. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    subjectId: text("subject_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_owner_type").on(t.ownerId, t.type)],
);

export const apiKeyProvider = pgEnum("api_key_provider", [
  "anthropic",
  "openai",
  "gemini",
  "elevenlabs",
  "fal",
  "pexels",
  "pixabay",
]);

/**
 * A user's own provider key (BYOK). `secret` is AES-256-GCM ciphertext bound to (owner, provider);
 * the plaintext key is never stored or returned to the browser.
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: apiKeyProvider("provider").notNull(),
    secret: text("secret").notNull(),
    last4: text("last4").notNull(),
    model: text("model"),
    imageModel: text("image_model"),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_api_keys_owner_provider").on(t.ownerId, t.provider)],
);

/** A user's paid plan, mirrored from Stripe webhooks. One row per user. */
export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan"),
  status: text("status").notNull().default("incomplete"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "string" }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

/**
 * Credits granted by a paid invoice. They expire at `periodEnd` (no rollover); `expiredAt` marks that the unspent
 * remainder has been removed from the ledger. One grant per (invoice, unit), so webhook replays can't double-grant.
 */
export const creditGrants = pgTable(
  "credit_grants",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unit: creditUnit("unit").notNull(),
    amount: integer("amount").notNull(),
    plan: text("plan").notNull(),
    invoiceId: text("invoice_id").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "string" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "string" }).notNull(),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_grants_invoice_unit").on(t.invoiceId, t.unit),
    index("credit_grants_due").on(t.expiredAt, t.periodEnd),
  ],
);

/** Webhook events already applied (Stripe retries and replays deliver the same event id again). */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
});

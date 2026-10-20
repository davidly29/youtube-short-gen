import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
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
import type {
  AudioClip,
  Beat,
  BriefItem,
  CaptionWord,
  Clip,
  KeyError,
  KeyUnavailable,
  Licence,
  PublishRequest,
} from "@shortloop/contracts";

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
  /** "admin" for emails listed in ADMIN_EMAILS (synced at sign-in); everyone else "user". */
  role: text("role").notNull().default("user"),
  /** Unlimited Shorts (admins and beta access-code holders). They still use their own AI keys. */
  creditExempt: boolean("credit_exempt").notNull().default(false),
  /** The beta access code this user redeemed, if any (counts towards the code's limit). */
  accessCode: text("access_code"),
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

export const channelStatus = pgEnum("channel_status", ["connected", "needs_reconnect", "disconnected"]);

/**
 * A connected publishing account (e.g. a YouTube channel). `secret` is the OAuth refresh token, AES-256-GCM
 * encrypted and bound to (owner, channel); it is never returned to the browser.
 */
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
    avatarUrl: text("avatar_url"),
    secret: text("secret"),
    scopes: text("scopes"),
    status: channelStatus("status").notNull().default("connected"),
    /** The niche the channel's daily brief covers (`DEFAULT_NICHES` id); no brief without one (E3-03). */
    nicheId: text("niche_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
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
    /** The trend topic this project was made from (E3-02 `Topic.id`); keeps it out of briefs for 14 days. */
    topicId: text("topic_id"),
    status: projectStatus("status").notNull().default("draft"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    scriptId: text("script_id"),
    timelineId: text("timeline_id"),
    renderAssetId: text("render_asset_id"),
    lastJobId: text("last_job_id"),
    error: text("error"),
    /** Things the user should know about how this Short was made (e.g. a fallback to free images). ADR 0007. */
    notices: jsonb("notices").$type<string[]>().notNull().default([]),
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
    /** One upload per (video, channel): `publishIdempotencyKey`. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    projectId: text("project_id"),
    jobId: text("job_id"),
    /** Resumable upload session, so a retry continues instead of starting a second upload. */
    uploadUrl: text("upload_url"),
    /** For `scheduled_next_window`: when the quota window reopens. */
    retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    index("publish_records_owner").on(t.ownerId),
    index("publish_records_status_retry").on(t.status, t.retryAt),
  ],
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
    /** Key health (ADR 0007): last successful call, last error, and jobs this key can't do. */
    lastOkAt: timestamp("last_ok_at", { withTimezone: true, mode: "string" }),
    lastError: jsonb("last_error").$type<KeyError>(),
    unavailable: jsonb("unavailable").$type<KeyUnavailable[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_api_keys_owner_provider").on(t.ownerId, t.provider)],
);

/** Which provider does each job for a user (ADR 0007). Values are validated by `ProviderRouting`. */
export const providerRouting = pgTable("provider_routing", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  llm: text("llm"),
  image: text("image"),
  tts: text("tts"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

/** Append-only ledger of calls made on ShortLoop's own keys, with estimated cost (ADR 0007). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    jobId: text("job_id"),
    capability: text("capability").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    units: integer("units").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    swap: boolean("swap").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_usage_owner_created").on(t.ownerId, t.createdAt),
    index("ai_usage_project").on(t.projectId),
    index("ai_usage_created").on(t.createdAt),
  ],
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

// ---- OAuth 2.1 provider for MCP clients (Better Auth jwt + @better-auth/mcp). Generated from the plugins' schemas.
export const authJwks = pgTable("auth_jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClient = pgTable("auth_oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled"),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes").array(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_p_k_c_e"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
});

export const oauthResource = pgTable("auth_oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required"),
  disabled: boolean("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  policyVersion: integer("policy_version"),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable("auth_oauth_client_resource", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  resourceId: text("resource_id")
    .notNull()
    .references(() => oauthResource.identifier, { onDelete: "cascade" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
});

export const oauthRefreshToken = pgTable("auth_oauth_refresh_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "date" }),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", { withTimezone: true, mode: "date" }),
  authTime: timestamp("auth_time", { withTimezone: true, mode: "date" }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
});

export const oauthAccessToken = pgTable("auth_oauth_access_token", {
  id: text("id").primaryKey(),
  token: text("token").unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
});

export const oauthConsent = pgTable("auth_oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const oauthClientAssertion = pgTable("auth_oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ---- Trend radar (E3-01)
export const trendSource = pgEnum("trend_source", ["youtube_popular", "wikipedia", "rss", "google_trends"]);

/**
 * Raw trend signals (metadata only: titles, keywords, view counts), kept 30 days by `pruneSignals`.
 * One row per (source, region, category, title, hour): re-running a collection in the same hour inserts nothing.
 */
export const trendSignals = pgTable(
  "trend_signals",
  {
    id: text("id").primaryKey(),
    source: trendSource("source").notNull(),
    region: text("region").notNull(),
    /** YouTube category id, or '' when the source isn't category-scoped (keeps the unique key NULL-free). */
    categoryId: text("category_id").notNull().default(""),
    niche: text("niche"),
    title: text("title").notNull(),
    url: text("url"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    metric: doublePrecision("metric").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
    /** `observedAt` truncated to the hour: the dedupe bucket. */
    observedHour: timestamp("observed_hour", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("trend_signals_dedupe").on(t.source, t.region, t.categoryId, t.title, t.observedHour),
    index("trend_signals_observed_at").on(t.observedAt),
  ],
);

/** One daily brief per channel and UTC day (E3-03); re-running the job replaces it. */
export const briefs = pgTable(
  "briefs",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD` (UTC). */
    date: text("date").notNull(),
    items: jsonb("items").$type<BriefItem[]>().notNull().default([]),
    generatedWith: text("generated_with").$type<"llm" | "template">().notNull(),
    partial: boolean("partial").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("briefs_channel_date").on(t.channelId, t.date)],
);

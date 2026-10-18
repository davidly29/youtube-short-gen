CREATE TYPE "public"."asset_kind" AS ENUM('video', 'image', 'audio');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('upload', 'own_channel', 'stock', 'ai_generated', 'library_music');--> statement-breakpoint
CREATE TYPE "public"."credit_unit" AS ENUM('short', 'ai_video_credit');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('script', 'voice', 'visuals', 'render', 'publish', 'trends');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube', 'tiktok', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('queued', 'uploading', 'scheduled', 'scheduled_next_window', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"source" "asset_source" NOT NULL,
	"licence" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"unit" "credit_unit" NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"cost_credits" real DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_records" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"channel_id" text NOT NULL,
	"video_asset_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" "publish_status" DEFAULT 'queued' NOT NULL,
	"external_id" text,
	"url" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"beats" jsonb NOT NULL,
	"cta" text NOT NULL,
	"language" text NOT NULL,
	"word_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timelines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fps" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"video" jsonb NOT NULL,
	"audio" jsonb NOT NULL,
	"captions" jsonb NOT NULL,
	"caption_style" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner" ON "assets" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_platform_external_id" ON "channels" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_owner_unit" ON "credit_ledger" USING btree ("owner_id","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_job_reason" ON "credit_ledger" USING btree ("job_id","reason") WHERE "credit_ledger"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "jobs_owner_status" ON "jobs" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "projects_owner" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "publish_records_owner" ON "publish_records" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "scripts_project" ON "scripts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timelines_project" ON "timelines" USING btree ("project_id");
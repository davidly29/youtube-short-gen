CREATE TYPE "public"."channel_status" AS ENUM('connected', 'needs_reconnect', 'disconnected');--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "secret" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "scopes" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "status" "channel_status" DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "upload_url" text;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "publish_records_status_retry" ON "publish_records" USING btree ("status","retry_at");--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_idempotency_key_unique" UNIQUE("idempotency_key");
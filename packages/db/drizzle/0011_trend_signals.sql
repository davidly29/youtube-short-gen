CREATE TYPE "public"."trend_source" AS ENUM('youtube_popular', 'wikipedia', 'rss', 'google_trends');--> statement-breakpoint
CREATE TABLE "trend_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "trend_source" NOT NULL,
	"region" text NOT NULL,
	"category_id" text DEFAULT '' NOT NULL,
	"niche" text,
	"title" text NOT NULL,
	"url" text,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metric" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"observed_hour" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trend_signals_dedupe" ON "trend_signals" USING btree ("source","region","category_id","title","observed_hour");--> statement-breakpoint
CREATE INDEX "trend_signals_observed_at" ON "trend_signals" USING btree ("observed_at");
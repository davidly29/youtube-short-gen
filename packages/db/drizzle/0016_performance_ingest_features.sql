ALTER TYPE "public"."job_type" ADD VALUE 'analytics';--> statement-breakpoint
CREATE TABLE "short_features" (
	"publish_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"features" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_metrics" (
	"publish_id" text NOT NULL,
	"date" text NOT NULL,
	"views" integer NOT NULL,
	"avg_view_pct" double precision NOT NULL,
	"likes" integer NOT NULL,
	"comments" integer NOT NULL,
	"subs_gained" integer NOT NULL,
	"swipe_away_rate" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "short_features" ADD CONSTRAINT "short_features_publish_id_publish_records_id_fk" FOREIGN KEY ("publish_id") REFERENCES "public"."publish_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_features" ADD CONSTRAINT "short_features_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_metrics" ADD CONSTRAINT "short_metrics_publish_id_publish_records_id_fk" FOREIGN KEY ("publish_id") REFERENCES "public"."publish_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "short_metrics_publish_date" ON "short_metrics" USING btree ("publish_id","date");
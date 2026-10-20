CREATE TABLE "briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"date" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_with" text NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "niche_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_channel_date" ON "briefs" USING btree ("channel_id","date");
CREATE TABLE "style_profiles" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"profile" jsonb NOT NULL,
	"source_video_count" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
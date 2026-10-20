CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text,
	"job_id" text,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"units" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"swap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_routing" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"llm" text,
	"image" text,
	"tts" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "notices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD COLUMN "last_ok_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD COLUMN "last_error" jsonb;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD COLUMN "unavailable" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_routing" ADD CONSTRAINT "provider_routing_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_owner_created" ON "ai_usage" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_project" ON "ai_usage" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
-- ai_usage is append-only: rows are never edited (deleting a user still cascades).
CREATE OR REPLACE FUNCTION ai_usage_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_usage is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ai_usage_append_only
BEFORE UPDATE ON ai_usage
FOR EACH ROW EXECUTE FUNCTION ai_usage_reject_update();

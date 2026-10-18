CREATE TYPE "public"."api_key_provider" AS ENUM('anthropic', 'openai', 'gemini', 'elevenlabs', 'fal', 'pexels', 'pixabay');--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"provider" "api_key_provider" NOT NULL,
	"secret" text NOT NULL,
	"last4" text NOT NULL,
	"model" text,
	"image_model" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_api_keys_owner_provider" ON "user_api_keys" USING btree ("owner_id","provider");
CREATE TYPE "public"."creation_mode" AS ENUM('conversation', 'structured');--> statement-breakpoint
CREATE TYPE "public"."generation_outcome" AS ENUM('success', 'degraded', 'playful', 'impossible', 'invalid');--> statement-breakpoint
CREATE TABLE "creation_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "creation_mode" NOT NULL,
	"recipe_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creation_session_id" uuid NOT NULL,
	"recipe_id" uuid,
	"outcome" "generation_outcome" NOT NULL,
	"advisory_comment" text,
	"model" text NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creation_session" ADD CONSTRAINT "creation_session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_session" ADD CONSTRAINT "creation_session_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_creation_session_id_creation_session_id_fk" FOREIGN KEY ("creation_session_id") REFERENCES "public"."creation_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creation_session_user_id_idx" ON "creation_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_creation_session_id_idx" ON "generation" USING btree ("creation_session_id");--> statement-breakpoint
CREATE INDEX "generation_recipe_id_idx" ON "generation" USING btree ("recipe_id") WHERE "generation"."recipe_id" IS NOT NULL;
CREATE TYPE "public"."report_status" AS ENUM('pending', 'resolved', 'rejected');--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "moderation_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "moderated_by" uuid;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_recipe_status_idx" ON "report" USING btree ("recipe_id","status");--> statement-breakpoint
CREATE INDEX "report_status_created_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_moderation_removed_idx" ON "recipe" USING btree ("moderation_removed_at") WHERE "recipe"."moderation_removed_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_moderation_consistency_chk" CHECK (("recipe"."moderation_removed_at" IS NULL) = ("recipe"."moderated_by" IS NULL));
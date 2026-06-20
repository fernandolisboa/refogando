ALTER TABLE "recipe_image" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD COLUMN "moderated_reason" text;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD COLUMN "moderated_by" uuid;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD CONSTRAINT "recipe_image_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_image_moderated_idx" ON "recipe_image" USING btree ("moderated_at") WHERE "recipe_image"."moderated_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD CONSTRAINT "recipe_image_moderation_consistency_chk" CHECK (("recipe_image"."moderated_at" IS NULL) = ("recipe_image"."moderated_by" IS NULL));
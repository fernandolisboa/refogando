CREATE TYPE "public"."image_provenance" AS ENUM('user_photo', 'ai_generated');--> statement-breakpoint
CREATE TABLE "recipe_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_url" text NOT NULL,
	"provenance" "image_provenance" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD CONSTRAINT "recipe_image_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_image_id_recipe_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."recipe_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_image_id_idx" ON "recipe" USING btree ("image_id") WHERE "recipe"."image_id" IS NOT NULL;
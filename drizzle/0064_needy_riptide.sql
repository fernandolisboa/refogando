ALTER TABLE "recipe_translation" ADD COLUMN "retranslate_fail_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_translation" ADD COLUMN "retranslate_fail_key" text;
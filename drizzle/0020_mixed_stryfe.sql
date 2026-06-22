ALTER TYPE "public"."origin" ADD VALUE 'web_imported';--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "source_name" text;
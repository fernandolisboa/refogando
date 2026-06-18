ALTER TYPE "public"."creation_mode" ADD VALUE 'free_text';--> statement-breakpoint
ALTER TYPE "public"."origin" ADD VALUE 'ai_free_text' BEFORE 'user_edited';--> statement-breakpoint
ALTER TABLE "creation_session" ADD COLUMN "free_text" text;
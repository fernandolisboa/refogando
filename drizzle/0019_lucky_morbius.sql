ALTER TABLE "app_config" ADD COLUMN "image_gen_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "image_gen_model" text DEFAULT 'gemini-3.1-flash-image' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "image_gen_cap_by_role" jsonb DEFAULT '{"usuario":3,"curador":5,"admin":null}'::jsonb NOT NULL;
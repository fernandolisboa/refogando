ALTER TABLE "image_generation" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "thinking_tokens" integer;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "cost_usd" numeric(12, 6);
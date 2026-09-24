ALTER TABLE "generation" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "cost_usd" numeric(12, 6);
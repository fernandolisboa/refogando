ALTER TABLE "recipe" ADD COLUMN "tempo_ativo_min" integer;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "tempo_total_min" integer;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_tempo_consistency_chk" CHECK ("recipe"."tempo_ativo_min" IS NULL OR ("recipe"."tempo_total_min" IS NOT NULL AND "recipe"."tempo_ativo_min" <= "recipe"."tempo_total_min"));
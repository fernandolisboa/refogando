ALTER TABLE "recipe" ALTER COLUMN "cozinha" SET DATA TYPE text USING "cozinha"::text;--> statement-breakpoint
ALTER TABLE "briefing" ALTER COLUMN "cozinha" SET DATA TYPE text USING "cozinha"::text;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_cozinha_vocabulary_term_slug_fk" FOREIGN KEY ("cozinha") REFERENCES "public"."vocabulary_term"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_cozinha_vocabulary_term_slug_fk" FOREIGN KEY ("cozinha") REFERENCES "public"."vocabulary_term"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."cozinha";
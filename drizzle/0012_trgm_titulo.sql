CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "recipe_translation_titulo_trgm_gin" ON "recipe_translation" USING gin (lower(immutable_unaccent("titulo")) gin_trgm_ops);

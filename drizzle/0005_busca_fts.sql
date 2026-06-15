CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION recipe_ts_config(text)
RETURNS regconfig
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT (CASE WHEN $1 LIKE 'pt%' THEN 'portuguese' ELSE 'english' END)::regconfig
$$;
--> statement-breakpoint
ALTER TABLE "recipe_translation" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector(recipe_ts_config("locale"), immutable_unaccent(coalesce("titulo", '') || ' ' || coalesce("descricao", '')))) STORED;
--> statement-breakpoint
CREATE INDEX "recipe_translation_search_vector_gin" ON "recipe_translation" USING gin ("search_vector");

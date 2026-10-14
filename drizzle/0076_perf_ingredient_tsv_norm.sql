-- Achados C (ingrediente) e E da auditoria de performance (2026-10-13): colunas GERADAS STORED, sem
-- backfill à parte (o ADD COLUMN de uma coluna gerada STORED reescreve a tabela e calcula o valor de toda
-- linha existente na hora). A reescrita segura ACCESS EXCLUSIVE na tabela até o commit (bloqueia também a
-- leitura): com o volume de hoje (~239 Receitas) é instantânea. As colunas de `recipe_ingredient` vão num
-- ALTER TABLE só, para reescrever a tabela uma vez. `lock_timeout` limita a espera por cada lock, como na
-- 0075: sem ele, um ALTER esperando atrás de uma transação longa enfileiraria as leituras e escritas
-- seguintes na tabela. Expressões IMMUTABLE: config constante (`'portuguese'::regconfig` vira constante no
-- parse) e `immutable_unaccent` (0005), como o `search_vector` de `recipe_translation`.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- Estatística da expressão que escolhe o braço da Busca por config (`recipe_ts_config(r2.original_locale) =
-- '<config>'`, search.ts `ingredientRawHitSql`). Sem ela o planner estima 0,5% das Receitas por config e,
-- com muitos termos, prefere ir pela Receita e testar o `@@` em cada Item (sem o GIN). Fora do drizzle-kit
-- (o schema não modela CREATE STATISTICS), como as funções da 0005. `recipe` vem primeiro, como na 0075.
CREATE STATISTICS "recipe_original_locale_ts_config_stx" ON (recipe_ts_config("original_locale")) FROM "recipe";--> statement-breakpoint
ALTER TABLE "recipe_ingredient"
  ADD COLUMN "raw_text_tsv_portuguese" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese'::regconfig, immutable_unaccent(raw_text))) STORED,
  ADD COLUMN "raw_text_tsv_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, immutable_unaccent(raw_text))) STORED,
  ADD COLUMN "raw_text_norm" text GENERATED ALWAYS AS (btrim(regexp_replace(lower(immutable_unaccent(raw_text)), '[[:space:][:punct:]]+', ' ', 'g'))) STORED;--> statement-breakpoint
CREATE INDEX "recipe_ingredient_raw_text_tsv_portuguese_gin" ON "recipe_ingredient" USING gin ("raw_text_tsv_portuguese");--> statement-breakpoint
CREATE INDEX "recipe_ingredient_raw_text_tsv_english_gin" ON "recipe_ingredient" USING gin ("raw_text_tsv_english");--> statement-breakpoint
ALTER TABLE "ingredient_translation" ADD COLUMN "nome_norm" text GENERATED ALWAYS AS (btrim(regexp_replace(lower(immutable_unaccent(nome)), '[[:space:][:punct:]]+', ' ', 'g'))) STORED;--> statement-breakpoint
-- Preenche já a estatística nova e as das colunas novas (o planner usa as do tsvector para estimar o `@@`),
-- em vez de esperar o auto-analyze. ANALYZE roda dentro da transação do migrator (VACUUM não rodaria).
ANALYZE "recipe", "recipe_ingredient", "ingredient_translation";

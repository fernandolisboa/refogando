# Handoff 68 — Ingrediente da Busca e Despensa em colunas geradas (migração 0076)

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `5deca16`, depois do #573). **Migração:** `0076_perf_ingredient_tsv_norm`. Continuação da auditoria do handoff 64: "migração 1" da ordem aprovada em `docs/perf/2026-10-13-respostas.md`, achados C (parte do ingrediente) e E. Sem mudança de UI, de regra ou de resposta: Busca e Despensa devolvem exatamente o que devolviam.

## 1. O que foi entregue

- **Migração 0076** (gerada com `drizzle-kit generate` a partir de `src/db/schema.ts` e ajustada à mão, como a 0075):
  - `SET LOCAL lock_timeout = '5s'`, como a 0075.
  - `CREATE STATISTICS recipe_original_locale_ts_config_stx ON (recipe_ts_config(original_locale)) FROM recipe` (à mão: o drizzle não modela estatísticas; `drizzle-kit generate` não a vê nem tenta apagar).
  - `recipe_ingredient`, num ALTER TABLE só (uma reescrita): `raw_text_tsv_portuguese` e `raw_text_tsv_english` (`to_tsvector('<config>'::regconfig, immutable_unaccent(raw_text))`) e `raw_text_norm` (`btrim(regexp_replace(lower(immutable_unaccent(raw_text)), '[[:space:][:punct:]]+', ' ', 'g'))`), todas `GENERATED ALWAYS … STORED`.
  - Um GIN em cada `tsvector` (`recipe_ingredient_raw_text_tsv_<config>_gin`).
  - `ingredient_translation.nome_norm`, gerada com a mesma normalização.
  - `ANALYZE recipe, recipe_ingredient, ingredient_translation`, para a estatística e as colunas novas valerem já.
  - Sem backfill à parte: o ADD COLUMN de uma coluna gerada STORED calcula o valor de toda linha existente na reescrita.
- **Busca, ramo `raw_text`** (`ingredientRawHitSql` em `src/server/recipe/search.ts`). Antes: `to_tsvector(recipe_ts_config(r2.original_locale), immutable_unaccent(ri.raw_text)) @@ websearch_to_tsquery(…)`, ou seja o tsvector de todo Item recalculado a cada busca, uma vez por par Item × termo, sem índice possível (a config vem de `recipe`). Agora: um braço por config de `RECIPE_TS_CONFIGS` (como o título no handoff 66), cada um com `recipe_ts_config(r2.original_locale) = '<config>'` e `ri.raw_text_tsv_<config> @@ websearch_to_tsquery('<config>', immutable_unaccent(t.term))`, unidos por `UNION ALL` e deduplicados por fora. Gates (playful, leitura do viewer #116, pool) iguais, em cada braço. O mapa config → coluna (`RAW_TEXT_TSV_COLUMN`) é tipado por `RECIPE_TS_CONFIGS`: config nova sem coluna não compila.
- **Por que uma coluna por config, e não uma coluna de locale em `recipe_ingredient`:** a config certa vem de `recipe.original_locale`, que coluna gerada não alcança. Copiar o locale para o Item exigiria preenchê-lo em todo caminho que escreve Itens e propagar uma mudança de `original_locale`. Com uma coluna por config, nenhum caminho de escrita muda, o valor nunca diverge e o braço da Busca é a mesma forma do título. Custo: dois `tsvector` e dois GIN por Item (tabela pequena).
- **Estatística da expressão:** sem ela, o planner estima 0,5% das Receitas por config. Com 2 termos ele já usava o GIN; com 16 (o teto) ia pela Receita e testava o `@@` em todo Item (3,3 s no banco de 8 mil Receitas, contra ~0,2 s com a estatística e 13 s antes da 0076).
- **Despensa** (`queryPantryMatches` em `src/server/pantry/pantry.ts`): `lines` lê `ri.raw_text_norm` e `it_names` lê `it.nome_norm` em vez de `norm(...)`. Nada mais muda na query. `norm` ficou exportada (só para a suíte) com um comentário: mudar a normalização exige mudar as duas colunas numa migração.
- **Fica calculado na consulta, de propósito** (detalhe em `docs/perf/2026-10-13-auditoria.md` §6):
  - **O nome traduzido do Item** (`tr.nome`): mora no jsonb `recipe_translation.ingredientes` e só vale quando `nomeOrigem` casa com o `raw_text` atual, e coluna gerada não alcança outra tabela. Gravar na escrita pediria cobrir os caminhos de `recipe_ingredient` (`generation/persist.ts`, `import/persist-import.ts`, `recipe/derive.ts`, `recipe/ingredients.ts`, `curate/create.ts`, `curate/resolve-item.ts`, dois scripts) e de `recipe_translation.ingredientes` (`recipe/translation.ts`, `translation/retranslate.ts`, `recipe/regenerate.ts`, `recipe/derive.ts`, `curate/create.ts`, `curate/translation-ingredient-names.ts`, `curate/translation-divergent-stale.ts`), mais um backfill. Não dava para provar cobertura total sem um trigger, e o ganho medido não justifica.
  - **Os `aliases` do canônico:** coluna gerada não aceita subquery (o `unnest`), e o catálogo canônico é pequeno.
  - **Sem `text[]` de palavras com GIN** (opcional no pedido): o pré-filtro teria de considerar também o nome traduzido, sem índice, então um pré-filtro exato ainda leria a tradução de toda linha. O que sobra de custo na Despensa é quebrar as linhas em palavras e a regex dos básicos, que dependem dos termos da pessoa.
- **Nits do PR anterior:** a chave do `unstable_cache` da receita da semana subiu de `'v2'` para `'v3'` (a tag ganhou o prefixo `refogando:` no #573) e a linha longa do comentário foi quebrada (`src/server/recipe/recipe-of-week.ts`).
- Relatório: C e E resolvidos, com o §6 novo (planos, medidas, equivalência). ADR-0038 e ADR-0008 ganharam uma linha de atualização.

## 2. Evidência

**Equivalência.**
- `test/integration/ingredient-index-equivalence.test.ts` (10 testes), num corpus adversarial: acento, caixa, largura total, ligadura, emoji, NBSP, tab, quebra de linha, pontuação pura, NULL e vazio; pt-BR, en-US, es-ES, `pt` e en-GB; privada do viewer, pública e privada de outro, `playful` e removida do pool.
  - Cada coluna gerada é igual à expressão antiga, linha a linha, e acompanha INSERT e UPDATE.
  - O `ingredient_raw_hit` antigo, copiado literal, e o novo dão os mesmos pares (Receita, termo) em 41 conjuntos de termos, com três viewers (anônimo, o dono, outro). Inclui operadores do websearch, termo vazio, só pontuação e os 16 termos.
  - A Despensa antiga (a query de hoje com cada coluna trocada pela expressão que ela guarda) e a nova dão a mesma resposta em 48 combinações: 4 despensas × 2 viewers × básicos ligados ou não × 3 locales.
  - Os GIN atendem o `@@` de cada braço, e a estatística existe.
- **Ponta a ponta contra `main`**, num banco local com 860 Receitas e 8.480 Itens (o módulo de `5deca16` contra o novo, com a 0076 aplicada):
  - `searchRecipes`: 864 combinações (54 consultas × any/all × pt-BR/en-US × anônimo/dono × relevância/popularidade), 736 com resultado;
  - `loadPantryMatches`: 12 combinações;
  - o "Cozinhei" (`withUsed` + `onlyRecipeId`): 400 combinações, 380 não vazias.
  - Nenhuma diferença.
- O SQL da Despensa de `main` é byte a byte o de hoje com as duas colunas trocadas pela expressão (fora as linhas de comentário).

**Planos** (8 mil Receitas, 80 mil Itens; tabela completa no relatório §6):

| Caso | Antes | Depois |
|---|---|---|
| `frango, cebola roxa` | 1,5–2,2 s. `ingredient_raw_hit` é Hash Join com `Join Filter: to_tsvector(recipe_ts_config(r2.original_locale), …) @@ …` (155 mil linhas descartadas, ~1,6 s) | 42–56 ms. Por braço, `Bitmap Index Scan on recipe_ingredient_raw_text_tsv_<config>_gin` com `Index Cond: … @@ websearch_to_tsquery('<config>', immutable_unaccent(t.term))`, `loops=2` (um por termo), e `recipe` pela PK (~15 ms no total) |
| 16 termos | 12,5–13,2 s | 0,15–0,21 s |
| Despensa, 200 itens | pt-BR 1,8–2,1 s; `lines` ~441 ms | pt-BR 1,45–1,8 s; `lines` ~168 ms |

## 3. O que ler primeiro

1. `docs/perf/2026-10-13-auditoria.md` §6: medidas, o que ficou calculado na consulta e por quê.
2. `drizzle/0076_perf_ingredient_tsv_norm.sql`: os comentários de cada bloco.
3. `src/server/recipe/search.ts`, `ingredientRawHitSql`: equivalência, gate e plano.
4. `src/server/pantry/pantry.ts`, `norm` e os CTEs `it_names`/`lines`.
5. `test/integration/ingredient-index-equivalence.test.ts`.

## 4. Princípios inegociáveis

- **Toda mudança de performance na Busca e na Despensa é provadamente equivalente.** Antigo e novo lado a lado, mesma resposta.
- **Um idioma novo em `recipe_ts_config` exige um braço novo em `RECIPE_TS_CONFIGS` e uma coluna `raw_text_tsv_<config>` com GIN**, numa migração. O tripwire do handoff 66 quebra se o corpo da função mudar, e `RAW_TEXT_TSV_COLUMN` não compila sem a coluna.
- **A normalização da Despensa existe em três lugares que andam juntos:** `norm` (pantry.ts) e as expressões de `raw_text_norm`/`nome_norm` (schema.ts e a migração). Mudou uma? Migração que recria as colunas no mesmo PR. A suíte compara `norm` com o texto antigo e as colunas com `norm`, linha a linha.
- **Coluna gerada não substitui dado de outra tabela.** O nome traduzido segue na consulta até alguém decidir gravá-lo na escrita com cobertura provada (trigger ou todos os caminhos de §1) e backfill.

## 5. Landmines

- **A 0076 reescreve `recipe_ingredient` sob ACCESS EXCLUSIVE** (bloqueia leitura e escrita de Itens até o commit) e `ingredient_translation` também. Medido: 326 ms com 40 mil Itens; em produção (~2.400 Itens) são dezenas de ms. `lock_timeout` de 5 s: se um lock não vier, o build falha e é só refazer. Todas as migrações de um deploy rodam numa transação só.
- **Expressões das colunas geradas são IMMUTABLE por declaração:** `immutable_unaccent` é IMMUTABLE por decreto (0005), como no `search_vector`. Se as regras do `unaccent` mudarem (upgrade da extensão) ou o banco for restaurado com outro `LC_CTYPE` (o `lower` e o `[[:punct:]]` dependem dele), o valor guardado pode divergir do que a expressão calcularia. Nesse caso: `UPDATE recipe_ingredient SET raw_text = raw_text` (e o mesmo em `ingredient_translation.nome`) recalcula tudo.
- **Config de texto em coluna gerada só como constante** (`'portuguese'::regconfig` vira constante no parse). Um cast de texto para `regconfig` por linha não é IMMUTABLE e a migração seria recusada.
- **`CREATE STATISTICS` com expressão exige PG 14+** (o Neon de produção e o container dos testes são 17). A estatística não está no schema do drizzle: se alguém regenerar a tabela `recipe` do zero, recrie-a.
- **`ANALYZE` dentro da migração:** roda na transação do migrator (VACUUM não rodaria) e é rápido no volume de hoje.
- **`-palavra` sozinho na Busca** (tsquery só com NOT) varre o GIN inteiro e casa quase todo Item: ~0,8 s no acervo de 8 mil, como antes (0,9 s). Não é regressão.
- **Teste com `EXPLAIN` no banco de teste:** com poucas linhas o planner vai pela Receita e não pelo GIN; por isso a suíte confere o GIN no predicado de cada braço e os planos do fragmento inteiro estão no relatório (banco com volume).
- **A consulta "antiga" da Despensa na suíte** é a de hoje com as colunas trocadas pela expressão (proxy em volta do `db`). Prova a troca e nada mais: uma mudança em outra parte da query vale para os dois lados.
- Herdados: nenhum backtick dentro de `sql\`...\``; `searchRecipes` não roda dentro de outra transação (GUC do trigrama).
- **Chave do Data Cache da receita da semana agora é `'v3'`:** suba de novo quando o formato guardado, os defaults ou a tag mudarem.
- Postgres local: cluster `17/perf` na 5433 (`postgres:postgres`). `TEST_DATABASE_URL`/`DATABASE_URL` vão inline por comando, nunca exportados. Para `drizzle-kit migrate`, passe também `DATABASE_URL_UNPOOLED` inline (o `drizzle.config.ts` prefere essa). Um vitest por vez no cluster.
- **`db:migrate` que falha por `lock_timeout` não diz o motivo no log:** o `drizzle-kit migrate` só imprime os NOTICEs e sai com 1. A transação volta inteira (nenhuma coluna, índice ou estatística fica pela metade); basta refazer o deploy.
- **Desfazer só no banco (raro; reverter o código basta, a mudança é aditiva):**
  ```sql
  DROP STATISTICS recipe_original_locale_ts_config_stx;
  DROP INDEX recipe_ingredient_raw_text_tsv_portuguese_gin, recipe_ingredient_raw_text_tsv_english_gin;
  ALTER TABLE recipe_ingredient DROP COLUMN raw_text_tsv_portuguese, DROP COLUMN raw_text_tsv_english, DROP COLUMN raw_text_norm;
  ALTER TABLE ingredient_translation DROP COLUMN nome_norm;
  DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791966555935;
  ```

## 6. Próximos passos (ordem aprovada em 2026-10-13)

1. **A, segundo passo:** ISR do detalhe público (bloqueios no handoff 67 §5).
2. **Migração 2, achado I:** derivados WebP da capa (~1280 px e ~400 px), original guardado, `srcset`, backfill.
3. **G:** gaveta "Criar" lazy (pré-carga, fallback para `/create`) + largura 512 px.
4. **Em espera:** B (HNSW) e H passo 2 (paginação), até o catálogo crescer. Despensa: pré-filtro por palavras e nome traduzido gravado na escrita, se o acervo crescer (§1).

## 7. Critério de saída

- PR mergeado com painel de revisão limpo e "checks" verde.
- **Em produção, depois do deploy:**
  - a 0076 aplicada: no Neon, `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1` devolve `created_at = 1791966555935` (o `when` da 0076 no `_journal.json`; a tabela do drizzle não tem coluna de nome; leitura só), ou o log do build da Vercel mostra o `db:migrate` sem erro;
  - smoke da Busca: `/pt-BR?q=frango` e um termo que só exista no texto de um Item devolvem resultado;
  - smoke da Despensa: `/pt-BR/me/pantry` com alguns itens mostra "Dá pra fazer agora"/"Falta pouco" como antes, sem 500.

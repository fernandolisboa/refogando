# Handoff 66 — Busca nos GIN, curinga literal e cache da receita da semana

**Sessão:** 2026-10-14. **Branch:** `claude/performance-audit-rj4e07` (sobre a main em `094dc60`, depois do #571). **Migração:** nenhuma. Continuação da auditoria do handoff 64: achado C (parte sem migração) e achado F, passo 3 da ordem aprovada em `docs/perf/2026-10-13-respostas.md`.

## 1. O que foi entregue

- **Full-text do título usa o GIN** (`titleFtsMatchedSql` em `src/server/recipe/search.ts`). O `matched` virou um braço por config (`RECIPE_TS_CONFIGS = ['portuguese', 'english']`, os dois valores de `recipe_ts_config`), cada um com `recipe_ts_config(rt.locale) = '<cfg>'::regconfig AND search_vector @@ websearch_to_tsquery('<cfg>', ...)` e `ts_rank` na mesma config, unidos por `UNION ALL`. Mesmas linhas e mesmo rank: cada linha cai em exatamente um braço com o tsquery que a função daria (locale NULL não casava antes e não entra agora).
- **Trigrama usa o GIN** (`trgmTitlePredicateSql`). `similarity(...) >= TRGM_MIN_SIM` virou o operador `%`; com o ILIKE, o planner faz `BitmapOr` de dois Bitmap Index Scan em `recipe_translation_titulo_trgm_gin` (expressão do 0012, idêntica à do predicado). O `%` é `>=` (conferido no PG 17 com um par de similaridade exatamente 0,3), e não há float4 entre 0,3 e 0,3f, então o corte é o mesmo.
- **Piso do trigrama garantido na transação** (`trgmThresholdSql`). Quando a lane de trigrama está ativa, a query da Busca roda numa transação que antes faz `set_config('pg_trgm.similarity_threshold', '0.3', true)` (literal, query simples). Custo: 3 idas e voltas a mais, contadas no fio. `TRGM_MIN_SIM` segue a fonte única.
- **Curinga literal (bug).** `%`, `_` e `\` digitados viravam curinga no ILIKE-contém da Busca (o comentário dizia o contrário) e no picker da Receita da semana (`searchCatalogApprovedRecipes`). A Busca escapa com `escapeLikeSql` (novo gêmeo SQL de `escapeLike` em `src/server/sql/like.ts`), DEPOIS da normalização, porque o `unaccent` transforma `％`/`＿`/`＼` em ASCII. O picker usa `escapeLike` direto (não normaliza).
- **Receita da semana: vencedor por Popularidade em cache de 10 min** (`src/server/recipe/recipe-of-week.ts`). `unstable_cache` guarda só o `recipe_id` (uma entrada para todos: não há viewer na query e o vencedor não depende do idioma). A linha exibida é relida por PK (`loadChosenCatalogRow`, mesmo gate do agregado) a cada request: remoção pela moderação, exclusão, saída de `approved`, edição de título e moderação da imagem valem na hora. Se o id guardado não passa no gate (ou o cache guardou `null`), recalcula ao vivo. `PUT /api/admin/config` chama `revalidateRecipeOfWeekPopularCache()` (`revalidateTag(tag, { expire: 0 })`) ao gravar `recipeOfWeek` ou `popularity`. `sort=popularidade` e cozinheiros recomendados seguem ao vivo.
- **Dublê de `next/cache` para a suíte node** (`test/helpers/next-cache.ts`, registrado em `test/setup.ts` com `vi.mock` e zerado por teste). Sem ele, `unstable_cache` lança fora do servidor do Next.
- Relatório `docs/perf/2026-10-13-auditoria.md`: C parcial, F resolvido, §4 com os planos antes/depois e as medidas. ADR-0008 ganhou uma linha de atualização.

## 2. O que ler primeiro

1. `docs/perf/2026-10-13-auditoria.md` §4 — planos, equivalência e custo de RTT.
2. `src/server/recipe/search.ts` — `trgmTitlePredicateSql`, `trgmThresholdSql`, `titleFtsMatchedSql` (o porquê de cada escolha está no comentário).
3. `test/integration/search-index-equivalence.test.ts` — predicados antigos copiados literal contra os novos; tripwire do corpo de `recipe_ts_config`; teste com o GUC do banco em 0,9.
4. `src/server/recipe/recipe-of-week.ts` — o bloco de comentário de `RECIPE_OF_WEEK_POPULAR_TAG` (o que é e o que não é cacheado).
5. `test/helpers/next-cache.ts` — o que o dublê imita e onde difere do Next.

## 3. Princípios inegociáveis

- **Toda mudança de performance na Busca é provadamente equivalente.** Predicado antigo e novo lado a lado num teste, ids e rank exatos. Mudança de resultado só como correção de bug declarada (o curinga).
- **Um idioma novo em `recipe_ts_config` exige um braço novo em `RECIPE_TS_CONFIGS`.** O tripwire da suíte de equivalência quebra se o corpo da função mudar.
- **O `%` do pg_trgm só roda com o piso fixado na mesma transação.** Nada de `set_limit()` (grava float4 0,3f, e o corte muda) nem de `SET` de sessão (vaza no pooler em modo transação).
- **Escape de LIKE depois da normalização** quando o termo passa por `immutable_unaccent` no banco (`escapeLikeSql`); `escapeLike` em JS só quando o termo vai cru.
- **Cache com dado de exibição não guarda a linha.** Guarda a chave cara (o id) e relê a linha com o gate. Assim nenhuma escrita de moderação/curadoria precisa lembrar de invalidar tag.

## 4. Landmines

- **`revalidateTag` só fora do render** (Route Handler ou Server Action). Por isso o caminho "id cacheado ficou inelegível" recalcula ao vivo e não renova o cache: a entrada ruim vive até os 10 min, custando o agregado ao vivo nesse intervalo (o custo de antes).
- **`revalidateTag(tag)` com um argumento está deprecado no Next 16.** Use `{ expire: 0 }` (expira já) ou `'max'` (serve o antigo uma vez).
- **Teste novo que toque `next/cache`:** a suíte node já usa o dublê; asserção de invalidação via `revalidatedTags()`. A suíte `ui` não tem o dublê (client components não importam `next/cache`).
- **postgres.js com `prepare:false` faz Parse+Describe antes do Bind em query parametrizada** (uma ida e volta a mais). Por isso o `set_config` vai como literal.
- **Nenhum backtick dentro de `sql\`...\``**, nem em comentário SQL (continua valendo nos fragmentos novos).
- Postgres local: cluster `17/perf` na 5433 (`postgres:postgres`), `TEST_DATABASE_URL` inline por comando, nunca exportado; um vitest por vez no cluster.

## 5. Próximos passos (ordem aprovada em 2026-10-13)

1. **A — páginas públicas cacheáveis:** tema por script pré-pintura (o layout para de ler `cookies()`), leituras do layout (vocabulário, `app_config`) com `unstable_cache` + tags invalidadas nas rotas de admin/curadoria, depois ISR do detalhe público. O padrão de dublê de `next/cache` deste PR serve para os testes.
2. **Migração 1 — C (ingrediente) + E:** coluna de config/`tsvector` gerado + GIN em `recipe_ingredient` (o `ingredient_raw_hit` é hoje ~290 ms com 40 mil itens locais) e as colunas normalizadas da Despensa (`raw_text_norm`, `nome_norm`).
3. **Migração 2 — I:** derivados WebP da capa (~1280 px e ~400 px), original guardado, `srcset`, backfill.
4. **G:** gaveta "Criar" lazy (pré-carga, fallback para `/create`) + largura 512 px (`sm:max-w-lg`).
5. **Em espera:** B (HNSW) e H passo 2 (paginação das listas), até o catálogo crescer.

## 6. Critério de saída

PR mergeado com painel de revisão limpo e "checks" verde.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import type { SearchHitRow } from '@/domain/recipe-search-read'
import { type EffectiveFacets, isFacetsEmpty } from '@/domain/facet-params'
import type { SortMode } from '@/domain/sort-params'
import { loadPopularityConfig } from '@/server/app-config'
import { loadGlobalRatingAverage } from '@/server/recipe/popularity'
import type { PopularityConfig } from '@/domain/popularity'
import { escapeLikeSql } from '@/server/sql/like'

/**
 * Loader FTS multi-row da Busca (issue #6, §3.4; estendido pela #9, §3.1). Diverge de
 * `loadRecipeRows` (que carrega UMA Receita via query builder): aqui é UMA query SQL
 * crua via `db.execute<SearchHitRow>(sql\`...\`)`, parametrizada pelo template do
 * Drizzle (bind seguro de `q`/`requestLocale`/`terms`/`mode`, sem interpolação → sem
 * injeção).
 *
 * #6 (TÍTULO, resultado preservado): casa CROSS-LOCALE (cada linha de
 * `recipe_translation` é indexada na sua própria config via a coluna gerada
 * `search_vector`; o tsquery é construído na MESMA config da linha —
 * `recipe_ts_config(rt.locale)`, um braço por config em `titleFtsMatchedSql` — para os
 * lexemas casarem) → dedup por Receita (`MAX(ts_rank)` entre as traduções que casaram).
 *
 * #9 (INGREDIENTE, novo eixo): cada termo de `?q=` (split por vírgula) resolve OU a um
 * Ingrediente canônico (match NORMALIZADO exato — lower+immutable_unaccent+fold
 * hífen→espaço — contra `ingredient_translation.nome` OU `aliases`, varrendo TODOS os
 * locales, SEM filtro por requestLocale), OU degrada para FTS sobre
 * `recipe_ingredient.raw_text` (config por `recipe.original_locale` via JOIN). O
 * `ingredient_overlap` conta termos DISTINTOS satisfeitos por Receita; o gate any/all
 * e o rank `(overlap + title_match)` saem do CTE `combined`. NUNCA referencia
 * `quantidade`/`unidade` (AC4).
 *
 * Tail COMPARTILHADO (#6, preservado): junta a espinha e aplica o GATE DE LEITURA
 * CANÔNICO (espelha `route.ts` isPublicRead: `owner_id IS NULL OR visibility=public`,
 * mais a exclusão explícita de `playful`) → secciona por `origin` → cap por seção via
 * ROW_NUMBER particionado. O LEFT JOIN duplo (tradução do locale pedido + tradução do
 * original) entrega ao módulo PURO `buildSearchResponse` os campos de display.
 *
 * `SearchHitRow` é OWNED pelo domínio (`@/domain/recipe-search-read`): o domínio define
 * o contrato de linha e o server o preenche — #9 emite EXATAMENTE os mesmos 8 campos.
 *
 * Nota de plano (§3.4/§6; atualizada na auditoria de performance de 2026-10-13, achado C): o
 * full-text do TÍTULO e a lane de trigrama usam os GIN de `recipe_translation` (ver
 * `titleFtsMatchedSql` e `trgmMatchedCteSql`), e a degradação raw_text usa os GIN das colunas
 * `tsvector` geradas de `recipe_ingredient` (migração 0076, `ingredientRawHitSql`). A resolução
 * canônica segue Seq Scan em `ingredient_translation` (catálogo canônico pequeno).
 */

export const MAX_QUERY_LEN = 256
const SECTION_CAP = 50

/**
 * Camada semântica (#14, Fork A). Limiar de cosseno anti-ruído PINADO: só-semânticos
 * (bucket 2 / sugestões) precisam de similaridade >= este valor para entrar. Separa os
 * fortes/moderados que DEVEM aparecer dos fracos/off-target. Cosseno = 1 - distância
 * (`<=>` com vector_cosine_ops). NÃO é uma fórmula de fusão — só um piso de entrada.
 *
 * 0.65 (medido): com `taskType` (RETRIEVAL_QUERY/DOCUMENT) o sinal real fica ~0.69–0.71 e o
 * RUÍDO de termos não-relacionados ~0.59–0.61 — 0.65 senta no meio dessa janela. O valor 0.50
 * anterior era abaixo do piso de ruído do `gemini-embedding-001` (deixava "feijoada" casar polvo).
 * Exportado pra suíte semântica semear acima/abaixo RELATIVO (sem cravar o número no teste).
 * Re-validar contra o corpus após o seed do catálogo (#238).
 */
export const SEMANTIC_MIN_SIM = 0.65
/** Cap anti-fan-out para sugestões (US38): um GET anônimo não draga o catálogo inteiro
 * por vizinhança. Por seção. (bucket 2 já respeita SECTION_CAP no caminho com precisa.) */
const SEMANTIC_CAP = 10

/**
 * Lane de TRIGRAMA (#118): recall por substring/typo no TÍTULO (pg_trgm), além do FTS.
 * `TRGM_MIN_SIM` é o piso da similaridade trigrama no ramo fuzzy (operador `%`) — um termo
 * só casa por fuzzy se a similaridade com o título normalizado for >= este valor. Constante
 * TUNÁVEL (sem migração): 'ovos' vs 'ovoss' (~0.5) e 'ovos' vs 'ovo' (~0.75) passam folgado;
 * palavras de 4 letras genuinamente não-relacionadas tendem a ficar abaixo. O ramo
 * ILIKE-contém NÃO é afetado por este piso (substring exata).
 *
 * FONTE ÚNICA do piso: o ramo fuzzy usa o operador `%` do pg_trgm (que é o que o GIN
 * trigrama atende), e o `%` compara contra o GUC `pg_trgm.similarity_threshold`. A Busca
 * fixa esse GUC para ESTE valor na própria transação (`trgmThresholdSql`, `set_config(...,
 * true)`), em vez de confiar no default do ambiente. Exportado pra suíte de equivalência.
 */
export const TRGM_MIN_SIM = 0.3
/**
 * Comprimento mínimo de termo para o predicado de trigrama (#118). 3 chars é o piso de
 * usabilidade do índice GIN trigrama: `show_trgm` de um termo de 2 chars rende ZERO trigramas
 * completos => o índice fica inalcançável (seqscan) e o ruído explode. Termos de 1-2 chars
 * NÃO entram na lane de trigrama; seguem cobertos pela lane FTS.
 */
const TRGM_MIN_TERM_LEN = 3

/**
 * Serializa o vetor-consulta para o LITERAL pgvector `'[...]'` que o cast `::vector`
 * aceita. NÃO usar `sql.param(number[])` cru: postgres-js serializa um number[] como
 * array PG `{...}` (encoder noop) e o cast `::vector` FALHA (provado no micro-spike #14).
 * Bindamos a STRING e castamos: `sql.param(vectorLiteral(v))::vector`.
 */
function vectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']'
}

/**
 * Corpo SELECT da CTE `semantic` (#14, Fork B) COMPARTILHADO (O1): candidatos por cosseno,
 * gate canônico replicado IDÊNTICO ao de `visible`, secção por origin, fallback de locale
 * via DISTINCT ON. Reusado pela query principal (loader) E pela query de sugestões (US38)
 * para que o gate canônico, o operador `<=>`, e a chave de prioridade de locale do
 * `DISTINCT ON` NÃO derivem entre as duas cópias. Recebe o literal pgvector bindado, o
 * requestLocale e o SQL de faceta (re-aplicado — faceta é FILTRO, nunca afrouxa).
 *
 * v1 (consciente): com `DISTINCT ON (re.recipe_id)` forçando `recipe_id` como chave-líder
 * do ORDER BY e SEM LIMIT, o planner faz um SCAN de distância COMPLETO — o índice HNSW NÃO
 * é exercitado neste caminho de leitura (tabelas minúsculas; exploração do HNSW por top-k
 * fica deferida). O índice é mandado pelo Fork B/ADR-0008 e future-proofs o crescimento.
 *
 * LANDMINE: NENHUM backtick dentro deste template (nem em comentário) — terminaria o
 * `sql\`...\``. Comentários explicativos ficam AQUI no TS, fora do template.
 */
function semanticSelectSql(
  litVec: string,
  requestLocale: string,
  facetSql: SQL,
  viewerId: string | undefined,
): SQL {
  return sql`
      SELECT DISTINCT ON (re.recipe_id)
        re.recipe_id AS recipe_id,
        (1 - (re.embedding <=> ${sql.param(litVec)}::vector)) AS cosine_sim,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.owner_id AS owner_id,
        r.created_at AS created_at, -- #368/M1: bucket-2 lê FROM semantic s; o frescor precisa do created_at aqui (senão 500)
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section
      FROM recipe_embedding re
      JOIN recipe r ON r.id = re.recipe_id
      WHERE re.embedding IS NOT NULL
        AND r.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r', viewerId)}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${facetSql}
      ORDER BY re.recipe_id,
        (re.locale = ${requestLocale}) DESC,
        (re.embedding <=> ${sql.param(litVec)}::vector) ASC
  `
}

/**
 * Predicados de faceta (#10) AND-combinados no WHERE do `visible`. NUNCA interpolam:
 * tudo via `sql.param` (bind seguro). Eixo vazio ⇒ no-op (guarda de `cardinality(...)=0`
 * ou bound NULL) — preserva o reduce-to-#6/#9 (facets vazio ⇒ todos no-op). Restrição usa
 * `@>` (acerta o GIN, contém-TODAS); Cozinha/Categoria/Tag usam OR dentro do eixo;
 * faixas numéricas são NULL-safe (NULL na coluna cai fora — UNKNOWN, intencional, AC5).
 *
 * O lado-tabela da Tag é folded no SQL com o MESMO fold de #9
 * (`lower(immutable_unaccent(replace(nome,'-',' ')))`); os valores do param já vêm folded
 * por `foldIntent` em JS — os dois lados coincidem.
 *
 * LANDMINE: NENHUM backtick dentro deste template (nem em comentario) — terminaria o
 * `sql\`...\``. Os comentarios explicativos ficam AQUI no TS, fora do template.
 */
function facetPredicates(facets: EffectiveFacets): SQL {
  const cozinhas = facets.cozinhas
  const categorias = facets.categorias
  const restricoes = facets.restricoes
  const tags = facets.tags
  const difMin = facets.dificuldade?.min ?? null
  const difMax = facets.dificuldade?.max ?? null
  const porMin = facets.porcoes?.min ?? null
  const porMax = facets.porcoes?.max ?? null

  return sql`
    AND (
      cardinality(${sql.param(cozinhas)}::text[]) = 0
      OR r.cozinha = ANY (${sql.param(cozinhas)}::text[])
    )
    AND (
      cardinality(${sql.param(categorias)}::categoria[]) = 0
      OR r.categoria = ANY (${sql.param(categorias)}::categoria[])
    )
    AND (
      cardinality(${sql.param(restricoes)}::restricao[]) = 0
      OR r.restricoes @> ${sql.param(restricoes)}::restricao[]
    )
    AND (${difMin}::int IS NULL OR r.dificuldade >= ${difMin}::int)
    AND (${difMax}::int IS NULL OR r.dificuldade <= ${difMax}::int)
    AND (${porMin}::int IS NULL OR r.porcoes >= ${porMin}::int)
    AND (${porMax}::int IS NULL OR r.porcoes <= ${porMax}::int)
    AND (
      cardinality(${sql.param(tags)}::text[]) = 0
      OR EXISTS (
        SELECT 1
        FROM recipe_tag rtg
        JOIN tag tg ON tg.id = rtg.tag_id
        WHERE rtg.recipe_id = r.id
          AND lower(immutable_unaccent(replace(tg.nome, '-', ' '))) = ANY (
            ${sql.param(tags)}::text[]
          )
      )
    )
  `
}

/**
 * CTE de TRIGRAMA (#118): emite os recipe_id cujo TÍTULO casa cada termo por substring
 * (ILIKE-contém) OU por similaridade (fuzzy/typo, pg_trgm). Fragmento de LÍDER-VÍRGULA
 * inserido INLINE na cadeia WITH, logo APÓS `ingredient_overlap` e ANTES de `combined`
 * (mesma técnica de montagem de `semanticCteSql`). Quando inativo (faceta-only OU nenhum
 * termo com `trim().length >= TRGM_MIN_TERM_LEN`) devolve `sql\`\`` (vazio) — e `combined`
 * NÃO adiciona o join de trigrama (paralelo a `hasVector` elidindo a CTE semântica).
 *
 * LEAK-SAFETY (#116/#118, requisito #1): junta `recipe_translation rt2` a `recipe r_tg` e
 * aplica `viewerReadableSqlFragment('r_tg', viewerId)` — `viewerId` é BINDADO (nunca
 * interpolado); anônimo (`viewerId` undefined) reduz ao gate de comunidade, byte-a-byte.
 * Pré-filtra os gates de pool (`moderation_removed_at IS NULL`) e de `playful`, espelhando
 * `ingredient_raw_hit`. Defesa-em-profundidade: o `visible` re-aplica o MESMO gate sobre
 * `combined`, então um id privado de outro dono nunca aflora mesmo se o join fosse burlado.
 *
 * BIND: o termo é bindado SÓ via `${sql.param(term)}` dentro do template `sql\`...\``
 * (idêntico a `${q}`/`${sql.param(terms)}`); o `'%' || ... || '%'`, o `ILIKE` e o `%` são
 * TEXTO LITERAL do template (não entrada de usuário) — sem injeção. NÃO usar concatenação
 * `sql.raw(...)+sql.param(...)`. Os predicados por termo moram em `trgmTitlePredicateSql`.
 */
function trgmMatchedCteSql(
  terms: string[],
  viewerId: string | undefined,
  active: boolean,
): SQL {
  if (!active) return sql``
  const longTerms = terms.filter((t) => t.trim().length >= TRGM_MIN_TERM_LEN)
  if (longTerms.length === 0) return sql``
  // Um predicado por termo; AND-combinados (todos os termos longos devem casar o título).
  const preds = longTerms.map((term) => trgmTitlePredicateSql(term))
  return sql`
    , trgm_matched AS (
      SELECT DISTINCT rt2.recipe_id AS recipe_id
      FROM recipe_translation rt2
      JOIN recipe r_tg ON r_tg.id = rt2.recipe_id
      WHERE r_tg.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r_tg', viewerId)}
        AND r_tg.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        AND ${sql.join(preds, sql` AND `)}
    )`
}

/**
 * Predicado de UM termo da lane de trigrama (#118) sobre `rt2.titulo`. Exportado só pra suíte
 * de equivalência (test/integration/search-index-equivalence.test.ts).
 *
 * ÍNDICE: os DOIS ramos casam a expressão do GIN `recipe_translation_titulo_trgm_gin`
 * (drizzle/0012: `lower(immutable_unaccent(titulo)) gin_trgm_ops`) byte a byte, então o planner
 * faz BitmapOr de dois Bitmap Index Scan (ILIKE é a estratégia LIKE do gin_trgm_ops; `%` é a de
 * similaridade). Antes o ramo fuzzy era `similarity(...) >= TRGM_MIN_SIM`: função, não operador,
 * e o OR com ela derrubava a query inteira (até o ramo ILIKE) para Seq Scan.
 *
 * EQUIVALÊNCIA do `%` (pg_trgm 1.6, PG 17): `a % b` é `similarity(a, b) >= similarity_threshold`
 * (`>=`, não `>`, apesar da doc dizer "greater than"; a suíte de equivalência prova com o GUC
 * fixado exatamente na similaridade float4 de um par, 0.3f). O GUC é float8 0.3 e a similaridade é
 * float4 (promovida a float8 na comparação); o predicado antigo comparava em float4 com o parâmetro
 * inferido como real (0.3f, um pouco acima de 0.3). Nenhum float4 fica em [0.3, 0.3f), então os dois
 * cortes coincidem. O GUC é fixado em `TRGM_MIN_SIM` na transação da Busca (`trgmThresholdSql`); o
 * índice GIN é com recheck, então a linha devolvida passa sempre pelo mesmo `%`.
 *
 * CURINGA (correção de bug): o termo do ramo ILIKE-contém é escapado (`escapeLikeSql`) DEPOIS da
 * normalização, então `%`, `_` e `\` digitados casam literalmente (antes viravam curinga: "100%"
 * casava qualquer título com "100"). Termo sem esses caracteres ⇒ padrão idêntico ao de antes. O
 * ramo `%` não é padrão LIKE (curinga não existe ali): segue com o termo normalizado cru.
 *
 * LANDMINE: NENHUM backtick dentro deste template (nem em comentário) — terminaria o
 * `sql\`...\``. Comentários explicativos ficam AQUI no TS, fora do template.
 */
export function trgmTitlePredicateSql(term: string): SQL {
  const normTerm = sql`lower(immutable_unaccent(${sql.param(term)}))`
  return sql`(
        lower(immutable_unaccent(rt2.titulo)) ILIKE '%' || ${escapeLikeSql(normTerm)} || '%'
        OR lower(immutable_unaccent(rt2.titulo)) % ${normTerm}
      )`
}

/**
 * Fixa `pg_trgm.similarity_threshold = TRGM_MIN_SIM` na transação corrente (`is_local = true`:
 * some no COMMIT/ROLLBACK, não vaza para outra query da conexão nem para outro cliente do pooler
 * do Neon em modo transação). Roda ANTES da query da Busca, na mesma transação, sempre que a lane
 * de trigrama está ativa.
 *
 * Por que não confiar no default (0.3 compilado no pg_trgm): um `ALTER DATABASE/ROLE SET`
 * mudaria o corte da Busca em silêncio. Por que não no mesmo statement (CTE com `set_config`): a
 * ordem de avaliação entre CTE e index scan não é garantida. Por que não parâmetro de conexão: o
 * pooler do Neon recusa startup parameters fora de uma lista curta.
 *
 * CUSTO: a transação acrescenta 2 idas e voltas (BEGIN e COMMIT) às buscas com termo de 3+
 * caracteres; contadas no fio com um proxy TCP, com o cliente do pooler (`prepare:false`). O
 * set_config vai como literal (query simples) no mesmo envio que a query principal (pipeline do
 * postgres.js na conexão reservada; ver `searchRecipes`), então não soma ida e volta. No pooler do
 * Neon na mesma região isso é da ordem de poucos ms; a rota já espera o embedding (HTTP externo, centenas de
 * ms) antes desta query. Em troca, o FTS e o fuzzy deixam de varrer todas as traduções: com 12 mil
 * traduções semeadas, ~30 ms e ~80 ms de Seq Scan viram ~4 ms e ~2 ms (docs/perf/2026-10-13-
 * auditoria.md, achado C, tem os planos e as medidas).
 */
export function trgmThresholdSql(): SQL {
  // Literal, não parâmetro: com parâmetro o postgres.js (prepare:false, pooler) faz Parse+Describe antes
  // do Bind e segura o pipeline ali, uma ida e volta a mais. O valor é a constante numérica acima, nunca
  // entrada de usuário.
  return sql.raw(`SELECT set_config('pg_trgm.similarity_threshold', '${TRGM_MIN_SIM}', true)`)
}

/**
 * Configs de full-text que `recipe_ts_config(locale)` pode devolver (drizzle/0005_busca_fts.sql:
 * `CASE WHEN $1 LIKE 'pt%' THEN 'portuguese' ELSE 'english' END`; `recipe_translation.locale` é NOT
 * NULL, então o caso STRICT de locale NULL não acontece). A suíte de equivalência trava o corpo da
 * função: um idioma novo na função sem entrar aqui quebra o teste em vez de sumir da Busca.
 */
export const RECIPE_TS_CONFIGS = ['portuguese', 'english'] as const

/**
 * CTE `matched` do full-text de TÍTULO (#6): match cross-locale + `ts_rank` por LINHA de
 * tradução, cada linha na config do seu `search_vector` (`recipe_ts_config(rt.locale)`).
 *
 * Um braço por config, com o tsquery em config CONSTANTE, unidos por UNION ALL. Antes era um
 * braço só com `websearch_to_tsquery(recipe_ts_config(rt.locale), ...)`: tsquery por linha, e o
 * `@@` virava Filter de Seq Scan (o GIN `recipe_translation_search_vector_gin` só atende um
 * tsquery constante). EQUIVALÊNCIA: toda linha tem `recipe_ts_config(rt.locale)` igual a
 * exatamente uma das configs (o locale é NOT NULL, então a função nunca devolve NULL), então cai
 * em um braço só, com o MESMO tsquery e o MESMO `ts_rank` de antes (a config substituída é a que
 * a função devolveria). O `ranked` (MAX por receita) não muda. Coberto pela suíte de equivalência.
 *
 * O nome da config entra por `sql.raw` (constante de código, nunca entrada de usuário); `q` é
 * bindado em cada braço.
 *
 * LANDMINE: NENHUM backtick dentro deste template (nem em comentário).
 */
export function titleFtsMatchedSql(q: string): SQL {
  const arms = RECIPE_TS_CONFIGS.map((cfg) => {
    const cfgSql = sql.raw(`'${cfg}'::regconfig`)
    return sql`
      SELECT
        rt.recipe_id AS recipe_id,
        ts_rank(rt.search_vector, websearch_to_tsquery(${cfgSql}, immutable_unaccent(${q}))) AS rank
      FROM recipe_translation rt
      WHERE recipe_ts_config(rt.locale) = ${cfgSql}
        AND rt.search_vector @@ websearch_to_tsquery(${cfgSql}, immutable_unaccent(${q}))`
  })
  return sql.join(arms, sql`
      UNION ALL`)
}

/**
 * Coluna `tsvector` GERADA de `recipe_ingredient` para cada config de `RECIPE_TS_CONFIGS`
 * (drizzle/0076: `to_tsvector('<config>'::regconfig, immutable_unaccent(raw_text))`, um GIN em cada).
 * Tipada por config: um idioma novo em `RECIPE_TS_CONFIGS` sem a coluna dele não compila.
 */
const RAW_TEXT_TSV_COLUMN: Record<(typeof RECIPE_TS_CONFIGS)[number], string> = {
  portuguese: 'raw_text_tsv_portuguese',
  english: 'raw_text_tsv_english',
}

/**
 * CTE `ingredient_raw_hit` (#9): a degradação por `raw_text` de cada termo, como pares (Receita,
 * termo). Lê a CTE `terms` da query da Busca. Exportado só pra suíte de equivalência
 * (test/integration/ingredient-index-equivalence.test.ts).
 *
 * Um braço por config, unidos por UNION ALL e deduplicados no SELECT DISTINCT de fora, como no full-text do
 * título (`titleFtsMatchedSql`). Antes era um braço só com
 * `to_tsvector(recipe_ts_config(r2.original_locale), immutable_unaccent(ri.raw_text)) @@ websearch_to_tsquery(
 * recipe_ts_config(r2.original_locale), immutable_unaccent(t.term))`: o tsvector de TODA linha de Item era
 * recalculado a cada busca (uma vez por par linha × termo), sem índice possível (a config vem de outra
 * tabela). Agora cada braço filtra as Receitas da sua config e casa o tsquery dessa config, constante por
 * termo, na coluna gerada da mesma config, que o GIN atende (achado C da auditoria de performance).
 *
 * EQUIVALÊNCIA: a coluna `raw_text_tsv_<cfg>` guarda exatamente `to_tsvector('<cfg>', immutable_unaccent(
 * raw_text))`, e `recipe_ts_config(original_locale)` de uma linha é igual a exatamente uma das configs
 * (`original_locale` é NOT NULL), então cada par (linha, termo) é avaliado em um braço só, com o mesmo
 * tsvector e o mesmo tsquery de antes. `raw_text` NULL dá coluna NULL (a função é STRICT), que não casa,
 * como antes. Os gates (playful, leitura do viewer, pool) são os de antes, em cada braço.
 *
 * GATE (#116, load-bearing): o gate de leitura aqui ESPELHA o do CTE `visible` (`viewerReadableSqlFragment`,
 * mesmo `viewerId` bindado). Com viewer logado o `visible` deixa passar as PRÓPRIAS privadas; se este
 * filtrasse só a comunidade, um ingrediente-por-raw_text da própria privada não casaria (overlap=0) e a
 * Receita do dono não apareceria por ingrediente.
 *
 * PLANO: com volume, cada braço vira um Bitmap Index Scan no GIN da config, parametrizado por termo
 * (`terms` por fora do Nested Loop), e só então junta `recipe` pela PK. Para isso o planner precisa saber
 * quantas Receitas há de cada config: a 0076 cria a estatística `recipe_original_locale_ts_config_stx` sobre
 * `recipe_ts_config(original_locale)`. Sem ela a estimativa é 0,5% das Receitas e, com muitos termos, o
 * planner vai pela Receita e testa o `@@` em todo Item (medido com 16 termos e 8 mil Receitas: 3,3 s sem a
 * estatística, ~0,2 s com; antes da 0076, 13 s).
 *
 * O nome da config e o da coluna entram por `sql.raw` (constantes de código, nunca entrada de usuário);
 * o termo vem da CTE `terms` (bindado lá) e o `viewerId` é bindado em cada braço.
 *
 * LANDMINE: NENHUM backtick dentro deste template (nem em comentário).
 */
export function ingredientRawHitSql(viewerId: string | undefined): SQL {
  const arms = RECIPE_TS_CONFIGS.map((cfg) => {
    const cfgSql = sql.raw(`'${cfg}'::regconfig`)
    const tsvSql = sql.raw(`ri.${RAW_TEXT_TSV_COLUMN[cfg]}`)
    return sql`
      SELECT ri.recipe_id AS recipe_id, t.idx AS term_idx
      FROM recipe_ingredient ri
      JOIN recipe r2 ON r2.id = ri.recipe_id
      CROSS JOIN terms t
      WHERE ri.raw_text IS NOT NULL
        AND r2.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r2', viewerId)}
        AND r2.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        AND recipe_ts_config(r2.original_locale) = ${cfgSql}
        AND ${tsvSql} @@ websearch_to_tsquery(${cfgSql}, immutable_unaccent(t.term))`
  })
  return sql`
      SELECT DISTINCT x.recipe_id AS recipe_id, x.term_idx AS term_idx
      FROM (${sql.join(arms, sql`
      UNION ALL`)}
      ) x`
}

/**
 * Resultado do loader (#14): os hits das seções (precisa floor + expansão semântica em
 * bucket 2 quando há precisa) e as `sugestoes` (só-semânticos quando ZERO precisa, US38).
 * No caso comum `sugestoes` é `[]`; no caso US38 `hits` é `[]`. Mantém SearchHitRow em 8
 * campos — o roteamento bucket-2 vs sugestões é explícito (não inferido por flag no DTO).
 */
export type SearchLoaderResult = {
  hits: SearchHitRow[]
  sugestoes: SearchHitRow[]
}

/**
 * Corpo do subquery de SAVES por receita (#368, ADR-0027/0028) COMPARTILHADO entre os DOIS sites de join
 * físicos: o `visible` (ON r.id) e o bucket-2 semântico (ON s.recipe_id). Fatorar o CORPO garante que a
 * self-exclusão NÃO derive entre as cópias (achado B2). LANDMINE B1-sec: self-save é PERMITIDO no
 * write-path (o save é marcador pessoal do dono), então o RANKING deve excluir o auto-save
 * (`rf.user_id <> rr.owner_id`) — senão o
 * dono infla a própria receita salvando-a. NULL-safe pro CATÁLOGO (owner NULL): `rr.owner_id IS NULL OR
 * ...` (`NULL <> x` é NULL ⇒ a linha do catálogo sumiria). `count(*)::int` = number (não string de bigint).
 *
 * MESMO UNIVERSO VIVO que a NOTA (ratingAggBodySql / loadGlobalRatingAverage): `JOIN users su ... AND
 * su.deleted_at IS NULL` DESCARTA o save de quem foi soft-deletado — senão o apreço de um usuário morto
 * seguiria inflando `wSave·ln(1+saves)` enquanto a nota dele já cai fora, quebrando a invariante do módulo.
 * `recipe_save.user_id` é NOT NULL (componente da PK) ⇒ o JOIN é seguro, sem tratamento de NULL.
 *
 * LANDMINE: NENHUM backtick dentro deste template. Comentários ficam AQUI, fora do `sql\`...\``.
 *
 * EXPORTADO (#457): reusado por `recipe-of-week.ts` no fallback de Popularidade da "Receita da
 * semana" (top-1 do catálogo aprovado) — mesmo corpo, sem duplicar a self-exclusão/universo vivo.
 */
export const savesAggBodySql = sql`
  SELECT rf.recipe_id AS recipe_id, count(*)::int AS saves
  FROM recipe_save rf
  JOIN recipe rr ON rr.id = rf.recipe_id
  JOIN users su ON su.id = rf.user_id AND su.deleted_at IS NULL
  WHERE (rr.owner_id IS NULL OR rf.user_id <> rr.owner_id)
  GROUP BY rf.recipe_id
`

/**
 * Corpo do subquery de NOTA por receita (#368) COMPARTILHADO entre os 2 sites de join (B2). LANDMINES:
 * `moderated_at IS NULL` (nota moderada não infla — M3) + `u.deleted_at IS NULL` (autor soft-deletado
 * fora, casa `loadAggregate`/o C global) + self-exclusão NULL-safe pro catálogo. Emite `rsum` (soma) e
 * `v` (contagem): a média R = `rsum/nullif(v,0)` é computada na fórmula do score (média VERDADEIRA, não
 * avg-de-avgs). `sum(...)::float8` (não string); `count(*)::int` (number).
 *
 * LANDMINE: NENHUM backtick dentro deste template.
 */
export const ratingAggBodySql = sql`
  SELECT rv.recipe_id AS recipe_id, sum(rv.rating)::float8 AS rsum, count(*)::int AS v
  FROM recipe_review rv
  JOIN users u ON u.id = rv.user_id
  JOIN recipe rr ON rr.id = rv.recipe_id
  WHERE rv.moderated_at IS NULL
    AND u.deleted_at IS NULL
    AND (rr.owner_id IS NULL OR rv.user_id <> rr.owner_id)
  GROUP BY rv.recipe_id
`

/**
 * Expressão SQL do score de POPULARIDADE de RECEITA (#368) — espelha `popularityScore` (domain/popularity)
 * termo a termo. LANDMINE math B1: TODA divisão tem `::float8` nos DOIS operandos. `m/(v+m)` com `m` e `v`
 * INTEIROS seria DIVISÃO INTEIRA no Postgres (trunca a 0 pra todo v>=1) ⇒ o prior sumiria e o ranking
 * inteiro sairia errado. `saves`/`rsum`/`v` vêm dos LEFT JOIN agregados (`sv`/`rt`); NULL (sem save/nota)
 * ⇒ COALESCE 0 ⇒ o CASE cai em C (prior puro). O frescor lê `createdAt` (r ou s, conforme o braço) e
 * clampa idade negativa (GREATEST(0,...)). `C` já vem bindado como número real (fallback 3.0 em TS, nunca
 * NULL). Tudo `::float8`.
 *
 * LANDMINE: NENHUM backtick dentro deste template.
 */
export function popularityScoreSql(cfg: PopularityConfig, C: number, createdAt: SQL): SQL {
  return sql`
    ${cfg.wSave}::float8 * ln(1 + COALESCE(sv.saves, 0)::float8)
    + ${cfg.wNota}::float8 * (
        CASE WHEN COALESCE(rt.v, 0) > 0
          THEN (rt.v::float8 / (rt.v::float8 + ${cfg.m}::float8)) * (rt.rsum / nullif(rt.v, 0)::float8)
             + (${cfg.m}::float8 / (rt.v::float8 + ${cfg.m}::float8)) * ${C}::float8
          ELSE ${C}::float8
        END
      )
    + ${cfg.wNovo}::float8 * exp(
        - GREATEST(0, EXTRACT(EPOCH FROM (now() - ${createdAt})) / 86400.0) / ${cfg.tauDays}::float8
      )
  `
}

export async function searchRecipes(
  db: Database,
  args: {
    q: string
    terms: string[]
    mode: 'any' | 'all'
    requestLocale: string
    facets: EffectiveFacets
    queryVector: number[] | null
    /**
     * Ordenação da Busca da COMUNIDADE (#16→#368, ADR-0003/0027/0028). 'popularidade' re-ranqueia a
     * Comunidade pela MISTURA de popularidade (save + nota Bayesiana + frescor) DENTRO do tier de
     * exatidão (NUNCA acima — ADR-0008); 'relevancia' (default) é o ranking híbrido de hoje, byte-a-byte.
     * O Catálogo é editorial e IGNORA sort (a chave de popularidade é gateada por section='comunidade').
     */
    sort?: SortMode
    /**
     * Viewer LOGADO (#116): inclui as PRÓPRIAS Receitas (privadas inclusive) em TODO site de
     * gate (visible/semantic/bucket2/ingredient_raw_hit), via `viewerReadableSqlFragment`.
     * `undefined` (anônimo, ADR-0011) ⇒ os gates reduzem ao de comunidade — Busca de antes
     * byte-a-byte. O `viewerId` é BINDADO como param em cada site (nunca interpolado).
     */
    viewerId?: string
  },
): Promise<SearchLoaderResult> {
  // Cap de entrada: truncar (nao rejeitar). O curto-circuito de estado neutro
  // (q vazio/so-espacos) vive no ROUTE; aqui, q vazio => websearch_to_tsquery
  // devolve query vazia => zero linhas (defensivamente seguro).
  const q = args.q.slice(0, MAX_QUERY_LEN)
  const requestLocale = args.requestLocale
  const terms = args.terms
  const facets = args.facets
  // #116: viewer logado (undefined = anônimo). Threaded em TODO site de gate abaixo.
  const viewerId = args.viewerId
  // Hardening no ponto de consumo: com terms=[] o ramo 'all' (ov.overlap = 0 sobre o
  // FULL OUTER JOIN) zeraria TODA linha so-titulo (ov.overlap=NULL). Um caller direto
  // que passe {terms:[], mode:'all'} cairia nessa armadilha; forcamos 'any'. No-op para
  // o route (que ja computa effectiveMode identico).
  const mode = terms.length === 0 ? 'any' : args.mode
  // N e conhecido em JS; inlinado (bindado) onde o gate 'all' precisa dele.
  const n = terms.length

  // #16: alterna a CHAVE de Popularidade no ORDER BY do `numbered`. Fragmento booleano SQL
  // (true/false) — NÃO um param de runtime que vaze: sob 'relevancia' o CASE colapsa a
  // constante 0 e o ORDER BY cai BYTE-A-BYTE no de hoje (#14). A chave entra DEPOIS do
  // bucket de exatidao e SO para section='comunidade' (Catalogo intocado — ADR-0003).
  const isPopularidade = args.sort === 'popularidade' ? sql`true` : sql`false`

  // #368 (ADR-0027/0028): a mistura de POPULARIDADE substitui a antiga chave de contagem do #16. cfg (pesos/m/tau)
  // + C (média GLOBAL da nota — prior da Bayesiana) carregados 1× por request, SÓ sob sort=popularidade
  // (gate de PERF: os LEFT JOIN agregados de save/nota e a coluna popularity_score só materializam nesse
  // caso; varrer recipe_save/recipe_review a cada Busca de relevância seria desperdício). Sob relevancia a
  // coluna colapsa a 0::float8 em TODO braço do UNION ALL (aridade intacta) e o ORDER BY cai byte-a-byte no
  // de hoje. Os CORPOS dos subqueries (savesAggBodySql/ratingAggBodySql) são COMPARTILHADOS entre os 2
  // sites de join físicos (visible ON r.id, bucket-2 ON s.recipe_id) — os guardas (self-exclusão +
  // moderated_at + deleted-author) NÃO podem derivar entre as cópias (achado B2). Catálogo intocado (a
  // chave é gateada a section='comunidade' no ORDER BY).
  const isPop = args.sort === 'popularidade'
  let savesJoinSql: SQL = sql``
  let ratingJoinSql: SQL = sql``
  let bucket2SavesJoinSql: SQL = sql``
  let bucket2RatingJoinSql: SQL = sql``
  let popularityColVisibleSql: SQL = sql`0::float8`
  let popularityColBucket2Sql: SQL = sql`0::float8`
  if (isPop) {
    // Config e média global são independentes: em paralelo (espelha recipe-of-week.ts).
    const [cfg, avg] = await Promise.all([loadPopularityConfig(db), loadGlobalRatingAverage(db)])
    // Fallback 3.0 bindado em TS como número real — NUNCA NULL (senão o CASE ELSE C ⇒ NULL ⇒ NULLS FIRST
    // no DESC ⇒ receitas de 0-nota ao topo, quebrando o guarda-corpo (b)).
    const C = avg ?? 3.0
    savesJoinSql = sql`LEFT JOIN (${savesAggBodySql}) sv ON sv.recipe_id = r.id`
    ratingJoinSql = sql`LEFT JOIN (${ratingAggBodySql}) rt ON rt.recipe_id = r.id`
    bucket2SavesJoinSql = sql`LEFT JOIN (${savesAggBodySql}) sv ON sv.recipe_id = s.recipe_id`
    bucket2RatingJoinSql = sql`LEFT JOIN (${ratingAggBodySql}) rt ON rt.recipe_id = s.recipe_id`
    popularityColVisibleSql = popularityScoreSql(cfg, C, sql`r.created_at`)
    popularityColBucket2Sql = popularityScoreSql(cfg, C, sql`s.created_at`)
  }

  // #10 faceta-only: ha facetas E o q efetivo NAO tem letra/digito (nem titulo nem
  // ingrediente podem casar => `combined` esta garantidamente vazio). Cobre q=''
  // (lente consumiu tudo), q=',,,' (parseSearchTerms=[]) e q='!!!' (terms.length=1 mas
  // FTS nao casa). Quando true, `visible` le de `recipe r` direto com sinais de texto
  // CONSTANTES (overlap=0, title_match=false, title_rank=0) => sort reduz a recipe_id
  // (faceta NAO e rank). Senao, le de `combined` (caminho #6/#9).
  const facetOnly = !isFacetsEmpty(facets) && !/[\p{L}\p{N}]/u.test(q)

  // Predicados de faceta AND-combinados no gate. Eixo vazio => no-op (reduce-to-#6/#9).
  const facetSql = facetPredicates(facets)

  // #14 camada semantica: so ativa quando ha vetor utilizavel. queryVector=null
  // (degradacao por embedder lancando, ou q vazio) OU faceta-only (route nao embeda)
  // => ramo semantico no-op => degradacao byte-identica ao ranking precisa de hoje.
  const hasVector =
    !facetOnly && args.queryVector !== null && args.queryVector.length > 0
  // Bind do vetor: STRING literal pgvector + cast ::vector (sql.param(number[]) cru
  // serializa como array PG {...} e o cast falha; provado no micro-spike). Vazio quando
  // !hasVector (ramo semantico elidido).
  const litVec = hasVector ? vectorLiteral(args.queryVector as number[]) : ''

  // CTE semantica (#14, Fork B): corpo SELECT COMPARTILHADO (semanticSelectSql, O1) reusado
  // pela query principal E pela de sugestoes (gate/operador/locale nao derivam entre as
  // duas). Montada SO quando hasVector; senao fragmento vazio (CTE elidida) => LEFT JOIN
  // some, bucket 2 some, cosine_sim constante 0.
  const semanticCteSql = hasVector
    ? sql`
    , semantic AS (${semanticSelectSql(litVec, requestLocale, facetSql, viewerId)})`
    : sql``

  // #118 lane de trigrama: ativa quando NÃO é faceta-only E há >=1 termo com
  // trim().length >= TRGM_MIN_TERM_LEN (a CTE filtra de novo, mas a flag gateia o JOIN em
  // `combined`). Inativa => CTE elidida (sql``) E `combined` byte-a-byte ao de hoje (sem o
  // join de trigrama) — paralelo a hasVector elidindo a CTE semântica. terms=[] força
  // mode='any' (acima) E desativa a lane (nenhum termo longo) => N=0 seguro.
  const trgmActive =
    !facetOnly && terms.some((t) => t.trim().length >= TRGM_MIN_TERM_LEN)
  const trgmMatchedSql = trgmMatchedCteSql(terms, viewerId, trgmActive)
  // Mudanças em `combined` SÓ quando a lane está ativa (senão byte-a-byte com o de hoje):
  //  - chave recipe_id passa a COALESCE de 3 fontes (ranked, ingredient_overlap, trgm);
  //  - 3o join FULL OUTER de trgm_matched;
  //  - o ramo 'any' do gate ganha `OR tg.recipe_id IS NOT NULL` (o 'all' fica intocado:
  //    um hit só-trigrama tem overlap=0 e NÃO satisfaz a estritude de ingrediente).
  const combinedRecipeIdSql = trgmActive
    ? sql`COALESCE(rk.recipe_id, ov.recipe_id, tg.recipe_id)`
    : sql`COALESCE(rk.recipe_id, ov.recipe_id)`
  const trgmJoinSql = trgmActive
    ? sql`FULL OUTER JOIN trgm_matched tg ON tg.recipe_id = COALESCE(rk.recipe_id, ov.recipe_id)`
    : sql``
  const trgmAnyPredSql = trgmActive ? sql` OR tg.recipe_id IS NOT NULL` : sql``

  // Coluna de similaridade no visible: COALESCE(s.cosine_sim,0) (NULL-safe) quando ha
  // semantic; constante 0 quando degradado (CTE elidida). O LEFT JOIN tambem so existe
  // quando hasVector.
  const cosineSelectSql = hasVector
    ? sql`COALESCE(s.cosine_sim, 0)`
    : sql`0::double precision`
  const semanticJoinSql = hasVector
    ? sql`LEFT JOIN semantic s ON s.recipe_id = c.recipe_id`
    : sql``

  // Bucket 2 (so-semanticos) UNIDO a fonte do visible SO quando hasVector E HA >=1
  // precisa VISIVEL (EXISTS combined APOS o gate canonico). Quando ZERO precisa visivel, o
  // EXISTS e falso => bucket 2 elide-se sozinho => main query vazia => o TS roda a query de
  // sugestoes (US38). Sem precisa, os so-semanticos nunca poluem as secoes; com precisa,
  // entram ABAIXO via tiering.
  //
  // M1 (gate na ativacao do bucket 2): `combined` e o conjunto de precisa ANTES do gate
  // canonico de leitura (o gate so e aplicado depois, em `visible`/`semantic`). Um EXISTS
  // cru sobre `combined` ativaria o bucket 2 mesmo quando a unica precisa e uma Receita
  // PRIVADA do dono cujo titulo casa o ?q= -- mas essa Receita e barrada pelo gate e nao
  // aparece em secao nenhuma, entao um vizinho semantico PUBLICO forte vazaria pra uma
  // secao em vez de ir pra `sugestoes?` (US38). Empurrar o gate canonico DENTRO do EXISTS
  // (mesma grafia IDENTICA do gate de `visible`/`semantic`) faz a ativacao depender da
  // precisa VISIVEL: sem precisa visivel, bucket 2 elide-se => hits vazio => o vizinho vai
  // corretamente pra `sugestoes?`.
  //
  // S2 (filtro de NaN): um embedding de norma-zero faz o `<=>` devolver NaN, e `cosine_sim`
  // (= 1 - NaN) vira NaN. NaN PASSA pelo `>= SEMANTIC_MIN_SIM` e ordena PRIMEIRO sob
  // `cosine_sim DESC` (Postgres ranqueia NaN acima de todo finito; COALESCE(...,0) NAO o
  // captura). ATENCAO: em Postgres `NaN = NaN` e TRUE (float8) -- entao `x = x` NAO filtra
  // NaN. O teste correto e `cosine_sim <> 'NaN'::float8` (FALSE p/ NaN => excluido; TRUE p/
  // finito => mantido).
  // #368 (bucket 2): mesma gate por sort que `visible`. O alias de join e `s` (semantic), entao os
  // LEFT JOIN agregados sao ON s.recipe_id (bucket2SavesJoinSql/bucket2RatingJoinSql, montados acima com
  // os MESMOS corpos do visible — B2). A coluna popularity_score usa `s.created_at` pro frescor (M1: o
  // semanticSelectSql passou a expor created_at). Sob relevancia a coluna e a constante 0::float8 e os
  // JOINs somem — aridade do UNION ALL mantida (popularity_score na MESMA posicao em todo ramo).
  const bucket2Sql = hasVector
    ? sql`
      UNION ALL
      SELECT
        s.recipe_id AS recipe_id,
        s.origin AS origin,
        s.original_locale AS original_locale,
        s.owner_id AS owner_id,
        0 AS overlap,
        false AS title_match,
        0::double precision AS title_rank,
        s.cosine_sim AS cosine_sim,
        s.section AS section,
        ${popularityColBucket2Sql} AS popularity_score
      FROM semantic s
      ${bucket2SavesJoinSql}
      ${bucket2RatingJoinSql}
      WHERE s.cosine_sim >= ${SEMANTIC_MIN_SIM}
        AND s.cosine_sim <> 'NaN'::float8
        AND EXISTS (
          SELECT 1 FROM combined c
          JOIN recipe r ON r.id = c.recipe_id
          WHERE r.result_kind <> 'playful'
            AND ${viewerReadableSqlFragment('r', viewerId)}
            AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        )
        AND NOT EXISTS (SELECT 1 FROM combined c WHERE c.recipe_id = s.recipe_id)
    `
    : sql``

  // Fonte do `visible`: faceta-only le de `recipe r` (sinais de texto constantes, cosine
  // 0); o caminho #6/#9 le de `combined c JOIN recipe r` + cosine via LEFT JOIN semantic
  // (NULL-safe) e (quando hasVector) o bucket 2 de so-semanticos. O gate canonico e as
  // facetas re-incluidos em AMBOS os ramos (faceta nunca afrouxa o gate).
  // #368: os LEFT JOIN agregados de save/nota (savesJoinSql/ratingJoinSql, montados acima com os corpos
  // COMPARTILHADOS, ON r.id) e a coluna popularity_score (popularityColVisibleSql) entram em CADA ramo de
  // `visible` (mesma posicao de coluna em TODO SELECT do UNION ALL — senao a aridade quebra).
  //
  // PERF (gate por sort): a coluna popularity_score SO e consumida na chave de Popularidade do ORDER BY,
  // gateada por `${isPopularidade}`. Sob relevancia (default + TODO o Catalogo) os JOINs somem (varrer
  // recipe_save/recipe_review a cada Busca pra um valor descartado seria desperdicio) e a coluna vira a
  // constante 0::float8. A aridade do UNION ALL fica intacta (todo ramo emite popularity_score).

  const visibleSource = facetOnly
    ? sql`
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.owner_id AS owner_id,
        0 AS overlap,
        false AS title_match,
        0::double precision AS title_rank,
        0::double precision AS cosine_sim,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        ${popularityColVisibleSql} AS popularity_score
      FROM recipe r
      ${savesJoinSql}
      ${ratingJoinSql}
      WHERE r.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r', viewerId)}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${facetSql}
    `
    : sql`
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.owner_id AS owner_id,
        c.overlap AS overlap,
        c.title_match AS title_match,
        c.title_rank AS title_rank,
        ${cosineSelectSql} AS cosine_sim,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        ${popularityColVisibleSql} AS popularity_score
      FROM combined c
      JOIN recipe r ON r.id = c.recipe_id
      ${semanticJoinSql}
      ${savesJoinSql}
      ${ratingJoinSql}
      WHERE r.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r', viewerId)}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${facetSql}
      ${bucket2Sql}
    `

  const mainSql = sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    matched AS (
      -- #6: match cross-locale + rank por LINHA de traducao, cada linha na config do seu
      -- indice (recipe_ts_config(rt.locale)); um braco por config, tsquery constante (usa o
      -- GIN). Roda sobre o ?q= INTEIRO (virgula vira AND no websearch_to_tsquery).
      ${titleFtsMatchedSql(q)}
    ),
    ranked AS (
      -- #6 VERBATIM: dedup por Receita: MAX rank entre as traducoes que casaram.
      SELECT recipe_id, MAX(rank) AS rank
      FROM matched
      GROUP BY recipe_id
    ),
    terms AS (
      -- #9: relacional de termos com indice. Bind de string[] como text[] +
      -- ORDINALITY. terms vazio => zero linhas => o ramo de ingrediente nao tem efeito
      -- (combined reduz a #6).
      SELECT t.term AS term, t.idx AS idx
      FROM unnest(${sql.param(terms)}::text[]) WITH ORDINALITY AS t(term, idx)
    ),
    ingredient_canonical AS (
      -- #9: resolve t.idx -> ingredient_id por nome OU alias, ALL-LOCALE (sem filtro por
      -- requestLocale). Fold normalizado dos DOIS lados:
      --   norm(x) := lower(immutable_unaccent(replace(x, '-', ' ')))
      -- Match EXATO de termo inteiro (igualdade de string normalizada), NUNCA token FTS:
      -- senao 'cebola' sozinho resolveria 'cebola-roxa'. aliases e text[] NULLABLE;
      -- unnest(NULL::text[]) rende zero linhas (seguro). it.nome e NOT NULL.
      SELECT DISTINCT t.idx AS term_idx, it.ingredient_id AS ingredient_id
      FROM terms t
      JOIN ingredient_translation it
        ON lower(immutable_unaccent(replace(it.nome, '-', ' ')))
             = lower(immutable_unaccent(replace(t.term, '-', ' ')))
           OR EXISTS (
             SELECT 1
             FROM unnest(it.aliases) AS a(alias)
             WHERE lower(immutable_unaccent(replace(a.alias, '-', ' ')))
                     = lower(immutable_unaccent(replace(t.term, '-', ' ')))
           )
    ),
    ingredient_canonical_hit AS (
      -- #9: junta os ids resolvidos as Receitas que os possuem.
      SELECT DISTINCT ri.recipe_id AS recipe_id, ic.term_idx AS term_idx
      FROM ingredient_canonical ic
      JOIN recipe_ingredient ri ON ri.ingredient_id = ic.ingredient_id
    ),
    ingredient_raw_hit AS (
      -- #9 (LANDMINE): degradacao raw_text. raw_text nao tem locale por-linha => a
      -- config vem de recipe.original_locale via JOIN; um braco por config, cada um no
      -- tsvector GERADO daquela config (GIN). NUNCA referencia quantidade/unidade (AC4).
      -- O porque (e a equivalencia com o to_tsvector por linha de antes) mora em
      -- ingredientRawHitSql, no TS.
      ${ingredientRawHitSql(viewerId)}
    ),
    ingredient_signal AS (
      -- #9: UNIAO dos dois sinais (canonico OR degradado satisfaz o termo). UNION (nao
      -- ALL) dedup ja em (recipe_id, term_idx): um termo satisfeito por AMBOS conta UMA vez.
      SELECT recipe_id, term_idx FROM ingredient_canonical_hit
      UNION
      SELECT recipe_id, term_idx FROM ingredient_raw_hit
    ),
    ingredient_overlap AS (
      -- #9: overlap por Receita = nro de termos DISTINTOS satisfeitos.
      SELECT recipe_id, COUNT(DISTINCT term_idx) AS overlap
      FROM ingredient_signal
      GROUP BY recipe_id
    )${trgmMatchedSql},
    combined AS (
      -- #9: FULL OUTER JOIN titulo (ranked, #6) x overlap. NAO trocar por INNER JOIN:
      -- droparia tanto as linhas so-titulo (sem overlap) quanto as so-ingrediente (sem
      -- match de titulo). Gate any/all:
      --   all  => ov.overlap = N (TODOS os termos como ingrediente; titulo NAO supre)
      --   any  => pertencimento ao JOIN (rk presente OU overlap>=1; tautologia mantida
      --           por simetria com o ramo all).
      -- #118: quando a lane de trigrama esta ativa, um 3o FULL OUTER JOIN traz os hits
      -- so-titulo-por-trigrama (overlap=0, title_match=false, title_rank=0). O ramo 'any'
      -- ganha OR tg.recipe_id IS NOT NULL; o 'all' fica intocado (trigrama nao supre a
      -- estritude de ingrediente). Inativa => os fragmentos sao vazios => byte-a-byte #9.
      SELECT
        ${combinedRecipeIdSql} AS recipe_id,
        COALESCE(ov.overlap, 0)              AS overlap,
        (rk.recipe_id IS NOT NULL)           AS title_match,
        COALESCE(rk.rank, 0)                 AS title_rank
      FROM ranked rk
      FULL OUTER JOIN ingredient_overlap ov ON ov.recipe_id = rk.recipe_id
      ${trgmJoinSql}
      WHERE
        CASE
          WHEN ${mode} = 'all' THEN ov.overlap = ${n}
          ELSE (rk.recipe_id IS NOT NULL OR COALESCE(ov.overlap, 0) >= 1${trgmAnyPredSql})
        END
    )${semanticCteSql},
    visible AS (
      -- #6 (tail): junta a espinha; GATE DE LEITURA CANONICO uniforme (espelha route.ts
      -- isPublicRead): owner NULL (catalogo/sistema, ADR-0011) OU visibility=public.
      -- Catalogo nasce private (default DB) mas owner_id NULL => legivel. Private de
      -- usuario (owned) nunca passa. playful excluido explicitamente. Secao por origin.
      -- #10: predicados de faceta AND-combinados com o gate (nunca o afrouxam; o ramo
      -- OR-NULL preservado). A coluna section dirige SO a particao/cap do ROW_NUMBER; o
      -- agrupamento (fonte da verdade) e classifySection(origin) em buildSearchResponse.
      -- Fonte (montada no TS em visibleSource): faceta-only le de recipe r (sinais de
      -- texto CONSTANTES); senao de combined JOIN recipe (caminho #6/#9). O gate canonico
      -- e re-incluido em AMBOS os ramos (faceta nunca afrouxa o gate).
      ${visibleSource}
    ),
    numbered AS (
      -- #14 (Fork A) TIERING ESTRITO + EXPANSAO: ranking SO DENTRO DA SECAO + cap.
      -- 1a chave: bucket de exatidao (precisa>0) DESC => TODO hit de precisa (bucket 1)
      -- ACIMA de TODO so-semantico (bucket 2). 2a: o rank precisa (overlap+title_match)
      -- DESC (#6/#9). 3a: cosine_sim DESC (re-ordena DENTRO do bucket e DESEMPATA). 4a:
      -- ts_rank de titulo DESC. 5a: recipe_id (tiebreaker deterministico). Degradado
      -- (cosine constante 0, bucket 2 vazio): 1a e 3a sao constantes => COLAPSA pro
      -- ORDER BY de hoje ((overlap+title_match) DESC, title_rank DESC, recipe_id).
      SELECT
        visible.recipe_id AS recipe_id,
        visible.origin AS origin,
        visible.original_locale AS original_locale,
        visible.owner_id AS owner_id,
        visible.section AS section,
        ROW_NUMBER() OVER (
          PARTITION BY visible.section
          ORDER BY
            (visible.overlap + CASE WHEN visible.title_match THEN 1 ELSE 0 END > 0) DESC,
            -- #368: Popularidade (mistura save+nota+frescor) entra DEPOIS do bucket de exatidao
            -- e SO na Comunidade (Catalogo intocado, ADR-0003). Sob sort=relevancia
            -- (isPopularidade=false) o CASE rende a constante 0::float8 (chave inerte) e o ORDER
            -- BY colapsa byte-a-byte no de hoje. visible.popularity_score ja vem do visible
            -- (float8 real sob popularidade, 0::float8 constante sob relevancia); o ELSE 0::float8
            -- mantem o tipo float8 em ambos os ramos (evita NULLS-FIRST do DESC).
            CASE
              WHEN visible.section = 'comunidade' AND ${isPopularidade}
              THEN visible.popularity_score
              ELSE 0::float8
            END DESC,
            (visible.overlap + CASE WHEN visible.title_match THEN 1 ELSE 0 END) DESC,
            visible.cosine_sim DESC,
            visible.title_rank DESC,
            visible.recipe_id
        ) AS rn
      FROM visible
    )
    ${displayTailSql(sql`n.rn <= ${SECTION_CAP}`, sql`n.section, n.rn`)}
  `

  // Lane de trigrama ativa: o operador % lê pg_trgm.similarity_threshold, então a query roda numa
  // transação que antes fixa o GUC em TRGM_MIN_SIM (trgmThresholdSql explica o porquê e o custo).
  // Inativa: nenhum % na query, uma ida só ao banco como antes.
  // Os dois statements vão juntos (Promise.all): na conexão reservada da transação o postgres.js os
  // escreve em ordem no mesmo envio (pipeline), e o servidor executa o set_config antes de ler a query
  // principal, então o GUC já vale para ela. Não chamar searchRecipes dentro de outra transação: o GUC
  // local duraria até o fim da transação de fora (o savepoint não o desfaz no RELEASE).
  const rows = trgmActive
    ? await db.transaction(async (tx) => {
        const [, main] = await Promise.all([
          tx.execute(trgmThresholdSql()),
          tx.execute<SearchHitRow>(mainSql),
        ])
        return main
      })
    : await db.execute<SearchHitRow>(mainSql)

  const hits = [...rows]

  // Roteamento A<->C (#14, §4): caso comum (HA >=1 precisa) o bucket 2 ja entrou nas
  // secoes via tiering e `hits` e nao-vazio => sem sugestoes (chave omitida no DTO).
  // Caso US38 (ZERO precisa): o bucket 2 elidiu-se sozinho (EXISTS combined falso) =>
  // `hits` vazio => roda a query de sugestoes (mesma CTE semantic + display tail).
  // So-semanticos nunca aparecem em secao E sugestoes (mutuamente exclusivo por
  // construcao). Sem vetor (degradacao/faceta-only): nunca ha sugestoes.
  if (!hasVector || hits.length > 0) {
    return { hits, sugestoes: [] }
  }

  // Query de sugestoes (US38): a MESMA CTE semantic compartilhada (semanticSelectSql, O1)
  // + cap por secao. S2: `s.cosine_sim <> 'NaN'::float8` descarta NaN (norma-zero), que de
  // outro modo passaria o limiar e ordenaria primeiro sob `cosine_sim DESC` (em Postgres
  // `NaN = NaN` e TRUE, entao `x = x` NAO filtraria).
  const sugestoesRows = await db.execute<SearchHitRow>(sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    semantic AS (${semanticSelectSql(litVec, requestLocale, facetSql, viewerId)}),
    numbered AS (
      SELECT
        s.recipe_id AS recipe_id,
        s.origin AS origin,
        s.original_locale AS original_locale,
        s.owner_id AS owner_id,
        s.section AS section,
        ROW_NUMBER() OVER (
          PARTITION BY s.section
          ORDER BY s.cosine_sim DESC, s.recipe_id
        ) AS rn
      FROM semantic s
      WHERE s.cosine_sim >= ${SEMANTIC_MIN_SIM}
        AND s.cosine_sim <> 'NaN'::float8
    )
    ${displayTailSql(sql`n.rn <= ${SEMANTIC_CAP}`, sql`n.section, n.rn`)}
  `)

  return { hits, sugestoes: [...sugestoesRows] }
}

/**
 * Display tail COMPARTILHADO (#14, S3): projeta os 8 campos do SearchHitRow a partir de
 * um CTE `numbered n` (com colunas recipe_id/origin/original_locale/section). CROSS JOIN
 * params + os DOIS LEFT JOIN de traducao (locale pedido + original) que `resolveName`/
 * `displayedProvenance` consomem. Reusado pela query principal E pela de sugestoes pra o
 * tail nao derivar entre as duas (uma sugestao sem display tail viria com translations
 * vazias e seria PULADA silenciosamente em buildSearchResponse).
 *
 * EXPORTADO (#454): o loader de "Receitas semelhantes" (`@/server/recipe/similar`) reusa esta
 * MESMA peça — precisa de um CTE `numbered` no shape esperado (recipe_id/origin/original_locale/
 * owner_id/section) + um CTE `params(req_locale)` no escopo, exatamente como os dois call sites
 * já existentes abaixo. Não duplicar esta projeção pela terceira vez.
 */
export function displayTailSql(whereClause: SQL, orderBy: SQL): SQL {
  return sql`
    SELECT
      n.recipe_id AS recipe_id,
      n.origin AS origin,
      n.original_locale AS original_locale,
      n.owner_id AS owner_id,
      n.section AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      u.name AS owner_name,
      u.handle AS owner_handle,
      ri.blob_url AS image_url,
      ri.provenance AS image_provenance,
      req_t.slug AS slug -- #231: slug do locale PEDIDO (mesmo LEFT JOIN do título) pro link canônico
    FROM numbered n
    CROSS JOIN params p
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = n.recipe_id AND req_t.locale = p.req_locale
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = n.recipe_id AND orig_t.locale = n.original_locale
    LEFT JOIN users u
      ON u.id = n.owner_id
    -- #130: thumbnail via recipe.image_id -> recipe_image.blob_url. O CTE numbered só carrega
    -- recipe_id, então re-juntamos recipe (r_img) para alcançar image_id; roda sobre o conjunto
    -- já capado/numerado (pequeno), custo desprezível.
    LEFT JOIN recipe r_img
      ON r_img.id = n.recipe_id
    LEFT JOIN recipe_image ri
      ON ri.id = r_img.image_id AND ri.moderated_at IS NULL -- #133: imagem moderada some do público
    WHERE ${whereClause}
    ORDER BY ${orderBy}
  `
}

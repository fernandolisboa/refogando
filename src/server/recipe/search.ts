import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import type { SearchHitRow } from '@/domain/recipe-search-read'
import { type EffectiveFacets, isFacetsEmpty } from '@/domain/facet-params'

/**
 * Loader FTS multi-row da Busca (issue #6, §3.4; estendido pela #9, §3.1). Diverge de
 * `loadRecipeRows` (que carrega UMA Receita via query builder): aqui é UMA query SQL
 * crua via `db.execute<SearchHitRow>(sql\`...\`)`, parametrizada pelo template do
 * Drizzle (bind seguro de `q`/`requestLocale`/`terms`/`mode`, sem interpolação → sem
 * injeção).
 *
 * #6 (TÍTULO, preservado VERBATIM): casa CROSS-LOCALE (cada linha de
 * `recipe_translation` é indexada na sua própria config via a coluna gerada
 * `search_vector`; o tsquery é construído na MESMA config por linha —
 * `recipe_ts_config(rt.locale)` — para os lexemas casarem) → dedup por Receita
 * (`MAX(ts_rank)` entre as traduções que casaram).
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
 * Nota de plano (§3.4/§6): config correlacionada por linha ⇒ o `@@` vira Filter sobre
 * Seq Scan (não usa o GIN nesta query); a resolução canônica e a degradação raw_text
 * também são Seq Scan (sem índice de expressão). ACEITO no v1 (tabelas minúsculas, cap
 * ~50; #14 retrabalha o ranking). Índice deferido.
 */

export const MAX_QUERY_LEN = 256
const SECTION_CAP = 50

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
      cardinality(${sql.param(cozinhas)}::cozinha[]) = 0
      OR r.cozinha = ANY (${sql.param(cozinhas)}::cozinha[])
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

export async function searchRecipes(
  db: Database,
  args: {
    q: string
    terms: string[]
    mode: 'any' | 'all'
    requestLocale: string
    facets: EffectiveFacets
  },
): Promise<SearchHitRow[]> {
  // Cap de entrada: truncar (nao rejeitar). O curto-circuito de estado neutro
  // (q vazio/so-espacos) vive no ROUTE; aqui, q vazio => websearch_to_tsquery
  // devolve query vazia => zero linhas (defensivamente seguro).
  const q = args.q.slice(0, MAX_QUERY_LEN)
  const requestLocale = args.requestLocale
  const terms = args.terms
  const facets = args.facets
  // Hardening no ponto de consumo: com terms=[] o ramo 'all' (ov.overlap = 0 sobre o
  // FULL OUTER JOIN) zeraria TODA linha so-titulo (ov.overlap=NULL). Um caller direto
  // que passe {terms:[], mode:'all'} cairia nessa armadilha; forcamos 'any'. No-op para
  // o route (que ja computa effectiveMode identico).
  const mode = terms.length === 0 ? 'any' : args.mode
  // N e conhecido em JS; inlinado (bindado) onde o gate 'all' precisa dele.
  const n = terms.length

  // #10 faceta-only: ha facetas E o q efetivo NAO tem letra/digito (nem titulo nem
  // ingrediente podem casar => `combined` esta garantidamente vazio). Cobre q=''
  // (lente consumiu tudo), q=',,,' (parseSearchTerms=[]) e q='!!!' (terms.length=1 mas
  // FTS nao casa). Quando true, `visible` le de `recipe r` direto com sinais de texto
  // CONSTANTES (overlap=0, title_match=false, title_rank=0) => sort reduz a recipe_id
  // (faceta NAO e rank). Senao, le de `combined` (caminho #6/#9).
  const facetOnly = !isFacetsEmpty(facets) && !/[\p{L}\p{N}]/u.test(q)

  // Predicados de faceta AND-combinados no gate. Eixo vazio => no-op (reduce-to-#6/#9).
  const facetSql = facetPredicates(facets)

  // Fonte do `visible`: faceta-only le de `recipe r` (sinais de texto constantes); o
  // caminho #6/#9 le de `combined c JOIN recipe r`. O resto da cadeia e identico.
  const visibleSource = facetOnly
    ? sql`
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        0 AS overlap,
        false AS title_match,
        0 AS title_rank,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section
      FROM recipe r
      WHERE r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
        ${facetSql}
    `
    : sql`
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        c.overlap AS overlap,
        c.title_match AS title_match,
        c.title_rank AS title_rank,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section
      FROM combined c
      JOIN recipe r ON r.id = c.recipe_id
      WHERE r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
        ${facetSql}
    `

  const rows = await db.execute<SearchHitRow>(sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    matched AS (
      -- #6 VERBATIM: match cross-locale + rank por LINHA de traducao; per-row config no
      -- tsquery (a MESMA config do indice da linha, recipe_ts_config(rt.locale)). Roda
      -- sobre o ?q= INTEIRO (virgula vira AND no websearch_to_tsquery).
      SELECT
        rt.recipe_id AS recipe_id,
        ts_rank(
          rt.search_vector,
          websearch_to_tsquery(
            recipe_ts_config(rt.locale),
            immutable_unaccent(${q})
          )
        ) AS rank
      FROM recipe_translation rt
      WHERE rt.search_vector @@ websearch_to_tsquery(
        recipe_ts_config(rt.locale),
        immutable_unaccent(${q})
      )
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
      -- config do to_tsvector vem de recipe.original_locale via JOIN (tempo de query).
      -- Os DOIS lados usam a MESMA config => lexemas casam. NUNCA referencia
      -- quantidade/unidade (AC4).
      -- PERF (v1, bounded/correto): o lado-documento to_tsvector(raw_text) NAO depende
      -- de t.term, mas o CROSS JOIN terms faz o Postgres reconstruir o tsvector uma vez
      -- por par (linha-raw_text x termo) -- ate MAX_TERMS vezes por linha. Aceitavel no
      -- v1 (tabelas minusculas); #14 deve materializar to_tsvector(raw_text) UMA vez por
      -- linha (ja gated) e dar @@ em cada termo.
      -- Gate de leitura empurrado para CA (perf, preservando comportamento): r2 (recipe)
      -- ja esta joinado aqui, entao aplicamos o MESMO gate canonico do CTE visible
      -- (playful excluido + owner NULL OR public) ANTES do @@ caro, descartando linhas de
      -- Receitas privadas/playful que o CTE visible dropa de qualquer jeito. overlap/rank
      -- sao por recipe_id e as Receitas gated nunca sobrevivem a visible, logo nenhum
      -- score de Receita visivel muda.
      SELECT DISTINCT ri.recipe_id AS recipe_id, t.idx AS term_idx
      FROM recipe_ingredient ri
      JOIN recipe r2 ON r2.id = ri.recipe_id
      CROSS JOIN terms t
      WHERE ri.raw_text IS NOT NULL
        AND r2.result_kind <> 'playful'
        AND (r2.owner_id IS NULL OR r2.visibility = 'public')
        AND to_tsvector(
              recipe_ts_config(r2.original_locale),
              immutable_unaccent(ri.raw_text)
            ) @@ websearch_to_tsquery(
              recipe_ts_config(r2.original_locale),
              immutable_unaccent(t.term)
            )
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
    ),
    combined AS (
      -- #9: FULL OUTER JOIN titulo (ranked, #6) x overlap. NAO trocar por INNER JOIN:
      -- droparia tanto as linhas so-titulo (sem overlap) quanto as so-ingrediente (sem
      -- match de titulo). Gate any/all:
      --   all  => ov.overlap = N (TODOS os termos como ingrediente; titulo NAO supre)
      --   any  => pertencimento ao JOIN (rk presente OU overlap>=1; tautologia mantida
      --           por simetria com o ramo all).
      SELECT
        COALESCE(rk.recipe_id, ov.recipe_id) AS recipe_id,
        COALESCE(ov.overlap, 0)              AS overlap,
        (rk.recipe_id IS NOT NULL)           AS title_match,
        COALESCE(rk.rank, 0)                 AS title_rank
      FROM ranked rk
      FULL OUTER JOIN ingredient_overlap ov ON ov.recipe_id = rk.recipe_id
      WHERE
        CASE
          WHEN ${mode} = 'all' THEN ov.overlap = ${n}
          ELSE (rk.recipe_id IS NOT NULL OR COALESCE(ov.overlap, 0) >= 1)
        END
    ),
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
      -- #6 (tail) + #9 rank: ranking SO DENTRO DA SECAO + cap. Sort-key primaria
      -- (overlap + title_match) DESC; depois o ts_rank de titulo DESC; recipe_id
      -- (tiebreaker deterministico). Com N<=1 e sem ingredientes (caso #6): overlap=0,
      -- title_match constante => reduz a (title_rank DESC, recipe_id) = ordem da #6.
      SELECT
        visible.recipe_id AS recipe_id,
        visible.origin AS origin,
        visible.original_locale AS original_locale,
        visible.section AS section,
        ROW_NUMBER() OVER (
          PARTITION BY visible.section
          ORDER BY
            (visible.overlap + CASE WHEN visible.title_match THEN 1 ELSE 0 END) DESC,
            visible.title_rank DESC,
            visible.recipe_id
        ) AS rn
      FROM visible
    )
    SELECT
      n.recipe_id AS recipe_id,
      n.origin AS origin,
      n.original_locale AS original_locale,
      n.section AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance
    FROM numbered n
    CROSS JOIN params p
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = n.recipe_id AND req_t.locale = p.req_locale
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = n.recipe_id AND orig_t.locale = n.original_locale
    WHERE n.rn <= ${SECTION_CAP}
    ORDER BY n.section, n.rn
  `)

  // postgres-js devolve um array-like/iteravel; materializa o SearchHitRow[].
  return [...rows]
}

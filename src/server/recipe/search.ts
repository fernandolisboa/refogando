import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import type { SearchHitRow } from '@/domain/recipe-search-read'
import { type EffectiveFacets, isFacetsEmpty } from '@/domain/facet-params'
import type { SortMode } from '@/domain/sort-params'

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
 * Camada semântica (#14, Fork A). Limiar de cosseno anti-ruído PINADO: só-semânticos
 * (bucket 2 / sugestões) precisam de similaridade >= este valor para entrar. Separa os
 * fortes/moderados que DEVEM aparecer dos fracos/off-target. Cosseno = 1 - distância
 * (`<=>` com vector_cosine_ops). NÃO é uma fórmula de fusão — só um piso de entrada.
 */
const SEMANTIC_MIN_SIM = 0.5
/** Cap anti-fan-out para sugestões (US38): um GET anônimo não draga o catálogo inteiro
 * por vizinhança. Por seção. (bucket 2 já respeita SECTION_CAP no caminho com precisa.) */
const SEMANTIC_CAP = 10

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
function semanticSelectSql(litVec: string, requestLocale: string, facetSql: SQL): SQL {
  return sql`
      SELECT DISTINCT ON (re.recipe_id)
        re.recipe_id AS recipe_id,
        (1 - (re.embedding <=> ${sql.param(litVec)}::vector)) AS cosine_sim,
        r.origin AS origin,
        r.original_locale AS original_locale,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section
      FROM recipe_embedding re
      JOIN recipe r ON r.id = re.recipe_id
      WHERE re.embedding IS NOT NULL
        AND r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
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
     * Ordenação da Busca da COMUNIDADE (#16, ADR-0003). 'popularidade' re-ranqueia a
     * Comunidade por vote_count DENTRO do tier de exatidão (NUNCA acima — ADR-0008);
     * 'relevancia' (default) é o ranking híbrido de hoje, byte-a-byte. O Catálogo é
     * editorial e IGNORA sort (a chave de popularidade é gateada por section='comunidade').
     */
    sort?: SortMode
  },
): Promise<SearchLoaderResult> {
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

  // #16: alterna a CHAVE de Popularidade no ORDER BY do `numbered`. Fragmento booleano SQL
  // (true/false) — NÃO um param de runtime que vaze: sob 'relevancia' o CASE colapsa a
  // constante 0 e o ORDER BY cai BYTE-A-BYTE no de hoje (#14). A chave entra DEPOIS do
  // bucket de exatidao e SO para section='comunidade' (Catalogo intocado — ADR-0003).
  const isPopularidade = args.sort === 'popularidade' ? sql`true` : sql`false`

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
    , semantic AS (${semanticSelectSql(litVec, requestLocale, facetSql)})`
    : sql``

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
  // #16 (bucket 2): mesma gate por sort que `visible`. O alias de join e `s` (semantic), nao
  // `r`, entao a copia inline do JOIN agregado e da coluna nao reusa voteCountJoinSql/
  // voteCountColSql (que falam de `r`/`vc`). Sob relevancia a coluna e a constante 0 e o JOIN
  // some — aridade do UNION ALL mantida (a coluna vote_count na MESMA posicao em todo ramo).
  const bucket2VoteCountColSql =
    args.sort === 'popularidade' ? sql`COALESCE(vc.vote_count, 0)` : sql`0`
  const bucket2VoteCountJoinSql =
    args.sort === 'popularidade'
      ? sql`LEFT JOIN (
        SELECT recipe_id, COUNT(*) AS vote_count FROM recipe_vote GROUP BY recipe_id
      ) vc ON vc.recipe_id = s.recipe_id`
      : sql``
  const bucket2Sql = hasVector
    ? sql`
      UNION ALL
      SELECT
        s.recipe_id AS recipe_id,
        s.origin AS origin,
        s.original_locale AS original_locale,
        0 AS overlap,
        false AS title_match,
        0::double precision AS title_rank,
        s.cosine_sim AS cosine_sim,
        s.section AS section,
        ${bucket2VoteCountColSql} AS vote_count
      FROM semantic s
      ${bucket2VoteCountJoinSql}
      WHERE s.cosine_sim >= ${SEMANTIC_MIN_SIM}
        AND s.cosine_sim <> 'NaN'::float8
        AND EXISTS (
          SELECT 1 FROM combined c
          JOIN recipe r ON r.id = c.recipe_id
          WHERE r.result_kind <> 'playful'
            AND (r.owner_id IS NULL OR r.visibility = 'public')
            AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        )
        AND NOT EXISTS (SELECT 1 FROM combined c WHERE c.recipe_id = s.recipe_id)
    `
    : sql``

  // Fonte do `visible`: faceta-only le de `recipe r` (sinais de texto constantes, cosine
  // 0); o caminho #6/#9 le de `combined c JOIN recipe r` + cosine via LEFT JOIN semantic
  // (NULL-safe) e (quando hasVector) o bucket 2 de so-semanticos. O gate canonico e as
  // facetas re-incluidos em AMBOS os ramos (faceta nunca afrouxa o gate).
  // #16: agregado de votos por Receita, juntado por LEFT JOIN em CADA ramo de `visible`
  // (mesma posicao de coluna em TODOS os SELECTs do UNION ALL — senao a aridade quebra).
  // Subquery agregada (nao correlacionada) reusada nos tres ramos via o mesmo fragmento.
  //
  // PERF (#16, gate por sort): a coluna vote_count SO e consumida na chave de Popularidade
  // do ORDER BY, gateada por `${isPopularidade}`. Sob sort=relevancia (default, e TODO o
  // Catalogo — que nunca usa Popularidade) a chave colapsa a constante 0 e vote_count NAO e
  // projetado (displayTailSql so projeta recipe_id/origin/original_locale/section). O ORDER
  // BY colapsa, mas o JOIN agregado NAO — ele executaria de qualquer jeito, varrendo a
  // recipe_vote INTEIRA (sem WHERE) a cada Busca pra produzir um valor descartado. Entao so
  // emitimos o LEFT JOIN agregado + a coluna real quando sort=popularidade; senao a coluna e
  // a constante `0 AS vote_count` e o JOIN some. A aridade do UNION ALL fica intacta (todos
  // os ramos emitem a coluna vote_count, so que constante 0 quando inerte).
  const voteCountJoinSql =
    args.sort === 'popularidade'
      ? sql`LEFT JOIN (
        SELECT recipe_id, COUNT(*) AS vote_count FROM recipe_vote GROUP BY recipe_id
      ) vc ON vc.recipe_id = r.id`
      : sql``
  // Expressao da coluna vote_count nos ramos do `visible` (facetOnly + combined): COUNT
  // coalescido quando ha o JOIN (popularidade); constante 0 quando o JOIN some (relevancia).
  const voteCountColSql =
    args.sort === 'popularidade' ? sql`COALESCE(vc.vote_count, 0)` : sql`0`

  const visibleSource = facetOnly
    ? sql`
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        0 AS overlap,
        false AS title_match,
        0::double precision AS title_rank,
        0::double precision AS cosine_sim,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        ${voteCountColSql} AS vote_count
      FROM recipe r
      ${voteCountJoinSql}
      WHERE r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
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
        ${cosineSelectSql} AS cosine_sim,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        ${voteCountColSql} AS vote_count
      FROM combined c
      JOIN recipe r ON r.id = c.recipe_id
      ${semanticJoinSql}
      ${voteCountJoinSql}
      WHERE r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${facetSql}
      ${bucket2Sql}
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
        AND r2.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
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
        visible.section AS section,
        ROW_NUMBER() OVER (
          PARTITION BY visible.section
          ORDER BY
            (visible.overlap + CASE WHEN visible.title_match THEN 1 ELSE 0 END > 0) DESC,
            -- #16: Popularidade entra DEPOIS do bucket de exatidao e SO na Comunidade
            -- (Catalogo intocado, ADR-0003). Sob sort=relevancia (isPopularidade=false) o
            -- CASE rende a constante 0 (chave inerte) e o ORDER BY colapsa byte-a-byte no de
            -- hoje. COALESCE(vote_count,0) ja vem do visible (coluna coalescida); o ELSE 0
            -- mantem o tipo int em ambos os ramos (evita NULLS-FIRST do DESC).
            CASE
              WHEN visible.section = 'comunidade' AND ${isPopularidade}
              THEN COALESCE(visible.vote_count, 0)
              ELSE 0
            END DESC,
            (visible.overlap + CASE WHEN visible.title_match THEN 1 ELSE 0 END) DESC,
            visible.cosine_sim DESC,
            visible.title_rank DESC,
            visible.recipe_id
        ) AS rn
      FROM visible
    )
    ${displayTailSql(sql`n.rn <= ${SECTION_CAP}`, sql`n.section, n.rn`)}
  `)

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
    semantic AS (${semanticSelectSql(litVec, requestLocale, facetSql)}),
    numbered AS (
      SELECT
        s.recipe_id AS recipe_id,
        s.origin AS origin,
        s.original_locale AS original_locale,
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
 */
function displayTailSql(whereClause: SQL, orderBy: SQL): SQL {
  return sql`
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
    WHERE ${whereClause}
    ORDER BY ${orderBy}
  `
}

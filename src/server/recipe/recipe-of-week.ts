import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import type { Database } from '@/db/client'
import { loadRecipeOfWeekConfig, loadPopularityConfig } from '@/server/app-config'
import { loadGlobalRatingAverage } from '@/server/recipe/popularity'
import { savesAggBodySql, ratingAggBodySql, popularityScoreSql } from '@/server/recipe/search'
import { projectResult, type SearchHitRow, type SearchResult } from '@/domain/recipe-search-read'
import { escapeLike } from '@/server/sql/like'
import { RECIPE_OF_WEEK_POPULAR_TAG } from '@/server/cache-tags'

/**
 * "Receita da semana" (#457, ADR-0026) — slot EDITORIAL fixo da home. Server-side, ANÔNIMO (sem
 * cookie/sessão — mesmo contrato de `loadDiscoveryFeed`), pra manter a home indexável/cacheável.
 *
 * DUAS fontes, nessa ordem:
 *  1. ESCOLHA DO CURADOR (`recipeOfWeekConfig.recipeId`, via `/admin/catalog`): RE-VALIDADA aqui
 *     contra o estado ATUAL da Receita (`origin=catalog AND curation_status='approved'`, não-
 *     `playful`, não-removida) — nunca confia cegamente no id salvo. Se o Curador trocou de ideia
 *     e rejeitou/despublicou a receita escolhida DEPOIS de escolhê-la, essa query não casa mais
 *     nenhuma linha e o slot degrada pro fallback (2), sem vazar rascunho nem quebrar a home.
 *  2. FALLBACK MECÂNICO por Popularidade (`recipeId` ausente OU escolha inválida): a receita de
 *     MAIOR score de popularidade (mistura save+nota+frescor, #368) dentre o catálogo aprovado.
 *     Espelha a fórmula EXATA de `search.ts` (`popularityScoreSql`) — MESMA disciplina de
 *     self-exclusão e universo vivo (save/nota de usuário soft-deletado não conta). O VENCEDOR fica
 *     em cache por 10 min (`RECIPE_OF_WEEK_POPULAR_REVALIDATE_S`); a linha exibida é sempre relida.
 *
 * NÃO fere o guarda-corpo "popularidade-sem-autoridade" (CONTEXT.md, Popularidade): aqui ela não
 * promove nada a catálogo (a receita já É catálogo aprovado) — só ordena qual das JÁ aprovadas
 * aparece quando NENHUM humano escolheu. Quem controla o slot primariamente é o Curador.
 *
 * Devolve `null` quando o catálogo aprovado está VAZIO (nenhuma receita elegível) — ou estava, no
 * cálculo cacheado de até 10 min atrás (ver `RECIPE_OF_WEEK_POPULAR_REVALIDATE_S`) — e a home
 * simplesmente omite o slot nesse caso (não é erro).
 *
 * SEM dedupe com o feed (decisão deliberada): a receita destacada aqui PODE reaparecer no
 * `loadDiscoveryFeed` logo abaixo. Os dois são superfícies independentes (o slot é editorial/fixo,
 * o feed é cronológico) e o custo de coordenar a exclusão entre duas queries paginadas por cursor
 * não compensa o benefício de esconder uma repetição — o selo/manchete já distingue os contextos.
 */
export async function loadRecipeOfTheWeek(
  db: Database,
  requestLocale: string,
): Promise<SearchResult | null> {
  const config = await loadRecipeOfWeekConfig(db)

  if (config.recipeId !== null) {
    const chosen = await loadCatalogResult(db, config.recipeId, requestLocale)
    if (chosen !== null) return chosen
    // Escolha inválida (id nunca existiu, ou a Receita saiu de `approved`/`catalog`/foi removida
    // desde a escolha) ⇒ degrada pro fallback abaixo, SEM lançar/quebrar a home.
  }

  // Fallback por Popularidade: o vencedor vem do cache (no máximo 10 min de idade, ver `computedAt`); a
  // linha exibida é lida AGORA (`loadChosenCatalogRow`, busca por PK com o mesmo gate do agregado).
  const cached = await unstable_cache(
    async (): Promise<PopularWinner> => ({ id: await loadMostPopularCatalogId(db), computedAt: Date.now() }),
    RECIPE_OF_WEEK_POPULAR_CACHE_KEY,
    { revalidate: RECIPE_OF_WEEK_POPULAR_REVALIDATE_S, tags: [RECIPE_OF_WEEK_POPULAR_TAG] },
  )()
  // O Next serve a entrada vencida e recalcula em segundo plano: sem este corte, com pouco tráfego a home
  // mostraria um vencedor de dias atrás. Vencida ⇒ ignora e calcula ao vivo (o refresh de fundo segue,
  // então essa visita custa dois agregados: o ao vivo e o do Next em segundo plano).
  if (Date.now() - cached.computedAt <= RECIPE_OF_WEEK_POPULAR_REVALIDATE_S * 1000) {
    // Catálogo vazio quando a entrada foi calculada: sem vencedor, sem segundo agregado.
    if (cached.id === null) return null
    const row = await loadCatalogResult(db, cached.id, requestLocale)
    if (row !== null) return row
  }
  // Entrada vencida, ou o vencedor guardado deixou de ser elegível (removido pela moderação, apagado,
  // saiu de `approved`): recalcula ao vivo, como antes do cache. O valor guardado só é renovado pelo
  // próprio cache (revalidar durante o render não é permitido).
  const liveId = await loadMostPopularCatalogId(db)
  return liveId === null ? null : loadCatalogResult(db, liveId, requestLocale)
}

/** Vencedor por Popularidade como fica no cache: o id (ou `null`, catálogo vazio) e quando foi calculado. */
type PopularWinner = { id: string | null; computedAt: number }

/** Linha de exibição gateada (`loadChosenCatalogRow`) já projetada no locale pedido; `null` se inelegível. */
async function loadCatalogResult(
  db: Database,
  recipeId: string,
  requestLocale: string,
): Promise<SearchResult | null> {
  const row = await loadChosenCatalogRow(db, recipeId, requestLocale)
  return row !== null ? projectResult(row, requestLocale) : null
}

/**
 * Cache do vencedor por Popularidade da "Receita da semana" (achado F da auditoria de performance,
 * 2026-10-13). O agregado (`savesAggBodySql`/`ratingAggBodySql` sobre `recipe_save`/`recipe_review`
 * inteiras, mais a média global e a config) rodava a cada visita à home sem escolha do Curador.
 *
 * O QUE é cacheado: só o `recipe_id` vencedor (ou `null`, catálogo vazio) e o instante do cálculo
 * (`computedAt`), no Data Cache do Next (`unstable_cache`; o app não liga `cacheComponents`, então não há
 * `use cache`). Uma entrada só, para todos: o vencedor não depende de quem vê (a home é anônima, não há
 * viewer na query) nem do idioma (candidatos e score não leem locale; o idioma só escolhe o título). É
 * um desvio consciente do "por idioma" de docs/perf/2026-10-13-respostas.md (achado F): uma entrada
 * por idioma guardaria o mesmo id várias vezes.
 *
 * IDADE MÁXIMA: `RECIPE_OF_WEEK_POPULAR_REVALIDATE_S` segundos. O `revalidate` sozinho não garante isso:
 * o Next devolve a entrada vencida ao primeiro request depois do prazo e só então recalcula em segundo
 * plano (com tráfego esparso, o vencedor exibido teria a idade do intervalo entre visitas). Por isso a
 * leitura compara `computedAt` com o prazo e, vencida, calcula ao vivo. Um vencedor novo (inclusive a
 * primeira receita de um catálogo que estava vazio) aparece em até 10 min.
 *
 * O QUE NÃO é cacheado: a linha exibida (título, slug, imagem). Ela é lida a cada request por PK
 * (`loadChosenCatalogRow`), que RE-VALIDA a elegibilidade com o mesmo gate do agregado (catálogo,
 * `approved`, não-`playful`, não-removida). Por isso uma receita cacheada não sobrevive à remoção pela
 * moderação, à exclusão nem à saída de `approved` (o catálogo não tem dono, então "ficar privada" não se
 * aplica), e uma edição de título ou a moderação da imagem aparecem na hora. Escolhemos re-checar na
 * leitura em vez de invalidar a tag em cada escrita: são muitos caminhos de escrita (moderação, curadoria,
 * exclusão, purge) e a checagem custa uma busca por PK que a home já fazia para montar a linha.
 *
 * INVALIDAÇÃO: `PUT /api/admin/config` chama `expireCacheTag(RECIPE_OF_WEEK_POPULAR_TAG)`
 * (`src/server/cache-tags.ts`, `{ expire: 0 }`: o próximo request recalcula, sem servir o valor antigo;
 * a home é dinâmica, então não há HTML em cache a perder) quando grava `recipeOfWeek` ou `popularity`
 * (os pesos mudam o vencedor). A escolha do Curador nunca passa pelo cache (a config é lida a cada
 * request), então aparece na hora; limpar a escolha volta para um vencedor recalculado. `sort=popularidade`
 * da Busca e os cozinheiros recomendados seguem ao vivo.
 */
export const RECIPE_OF_WEEK_POPULAR_REVALIDATE_S = 600
// Suba a versão quando o formato guardado (`PopularWinner`), os defaults ou a tag mudarem: o Data Cache da
// Vercel sobrevive ao deploy. 'v3': a tag ganhou o prefixo `refogando:` no #573.
const RECIPE_OF_WEEK_POPULAR_CACHE_KEY = ['receita-da-semana', 'vencedor-popularidade', 'v3']

/**
 * Verifica se um `recipeId` é HOJE um catálogo aprovado elegível (origin=catalog, approved,
 * não-playful, não-removida) — usado pelo PUT do admin (`/api/admin/config`) pra recusar a
 * ESCOLHA de uma receita que não é (ainda) catálogo público, ANTES de persistir o id (não é a
 * mesma checagem "leak-safe" da leitura — aqui é um 400 honesto pro Curador: "essa receita não é
 * catálogo aprovado", em vez de silenciosamente aceitar um id que a leitura descartaria depois).
 */
export async function isCatalogRecipeApproved(db: Database, recipeId: string): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok
    FROM recipe r
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  return rows.length > 0
}

/**
 * Carrega a linha de display de UMA Receita do catálogo, gateada (RE-VALIDA a elegibilidade nesta
 * query): serve à escolha do Curador e também à re-checagem do vencedor por Popularidade (cacheado ou
 * calculado agora), por isso o gate aqui é o mesmo do agregado de `loadMostPopularCatalogId`.
 */
async function loadChosenCatalogRow(
  db: Database,
  recipeId: string,
  requestLocale: string,
): Promise<SearchHitRow | null> {
  const rows = await db.execute<SearchHitRow>(sql`
    SELECT
      r.id AS recipe_id,
      r.origin AS origin,
      r.original_locale AS original_locale,
      r.owner_id AS owner_id,
      'catalogo' AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      NULL AS owner_name, -- catálogo é sempre owner_id NULL: sem autor humano (espelha feedQuery)
      NULL AS owner_handle,
      ri.blob_url AS image_url,
      ri.thumb_url AS image_thumb_url, -- achado I (0077): derivados WebP (NULL ⇒ o card usa o original)
      ri.detail_url AS image_detail_url,
      ri.provenance AS image_provenance,
      req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    LEFT JOIN recipe_image ri
      ON ri.id = r.image_id AND ri.moderated_at IS NULL -- imagem moderada some do público (#133)
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  return rows[0] ?? null
}

/** Teto de resultados do lookup de escolha do Curador (evita payload gigante num `ILIKE` largo). */
export const RECIPE_OF_WEEK_SEARCH_LIMIT = 10

export type RecipeOfWeekSearchHit = { recipeId: string; titulo: string; slug: string | null }

/**
 * Busca por TÍTULO restrita ao catálogo aprovado (#457) — alimenta o PICKER do Curador em
 * `/admin/catalog` (o Curador digita parte do título e escolhe entre os resultados). ADMIN-ONLY
 * pela rota (`requireRole('admin')`); esta função em si é só a query. `titulo`/`slug` do locale
 * PEDIDO — sem tradução naquele locale ⇒ `titulo` cai no ORIGINAL (a receita ainda aparece na
 * busca do curador, mas sem link direto até traduzir). `q` vazio/só-espaço ⇒ `[]` (não lista o
 * catálogo inteiro por engano). `%`, `_` e `\` digitados casam literalmente (`escapeLike`; antes viravam
 * curinga do ILIKE).
 */
export async function searchCatalogApprovedRecipes(
  db: Database,
  args: { q: string; requestLocale: string },
): Promise<RecipeOfWeekSearchHit[]> {
  const q = args.q.trim()
  if (q === '') return []
  const rows = await db.execute<{ recipe_id: string; titulo: string; slug: string | null }>(sql`
    SELECT r.id AS recipe_id, COALESCE(req_t.titulo, orig_t.titulo) AS titulo, req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${args.requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    WHERE r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
      AND COALESCE(req_t.titulo, orig_t.titulo) ILIKE ${'%' + escapeLike(q) + '%'}
    ORDER BY COALESCE(req_t.titulo, orig_t.titulo)
    LIMIT ${RECIPE_OF_WEEK_SEARCH_LIMIT}
  `)
  return rows.map((r) => ({ recipeId: r.recipe_id, titulo: r.titulo, slug: r.slug }))
}

/**
 * Título (locale pedido, ou original) de UM catálogo aprovado por id — alimenta o "escolha atual"
 * exibido no picker do Curador (#457): a config guarda só o `recipeId`; a UI precisa do TÍTULO pra
 * mostrar "Escolhida: <título>" sem o Curador ter de decorar o uuid. `null` quando o id não é
 * (mais) catálogo aprovado (espelha a mesma re-validação da leitura pública).
 */
export async function loadCatalogApprovedRecipeTitle(
  db: Database,
  recipeId: string,
  requestLocale: string,
): Promise<RecipeOfWeekSearchHit | null> {
  const rows = await db.execute<{ recipe_id: string; titulo: string; slug: string | null }>(sql`
    SELECT r.id AS recipe_id, COALESCE(req_t.titulo, orig_t.titulo) AS titulo, req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  const row = rows[0]
  return row ? { recipeId: row.recipe_id, titulo: row.titulo, slug: row.slug } : null
}

/**
 * Fallback: o id da receita de MAIOR score de Popularidade dentre o catálogo aprovado (top-1). A linha de
 * exibição sai de `loadChosenCatalogRow` (mesmo gate, mesmas colunas e joins que esta query projetava),
 * para o vencedor poder ser cacheado sem cachear título/imagem. Os joins de tradução e imagem saíram
 * daqui: são 1:1 (único por `recipe_id, locale`; imagem por PK), então não mudavam o top-1.
 */
async function loadMostPopularCatalogId(db: Database): Promise<string | null> {
  const [cfg, globalAvg] = await Promise.all([loadPopularityConfig(db), loadGlobalRatingAverage(db)])
  const C = globalAvg ?? 3.0 // mesmo fallback em TS de `search.ts` (NUNCA bindar NULL no SQL — ver popularity.ts)
  const rows = await db.execute<{ recipe_id: string }>(sql`
    WITH candidates AS (
      SELECT r.id AS recipe_id, r.created_at AS created_at
      FROM recipe r
      WHERE r.origin = 'catalog'
        AND r.curation_status = 'approved'
        AND r.result_kind <> 'playful'
        AND r.moderation_removed_at IS NULL
    )
    SELECT c.recipe_id AS recipe_id
    FROM candidates c
    LEFT JOIN (${savesAggBodySql}) sv ON sv.recipe_id = c.recipe_id
    LEFT JOIN (${ratingAggBodySql}) rt ON rt.recipe_id = c.recipe_id
    ORDER BY (${popularityScoreSql(cfg, C, sql`c.created_at`)}) DESC, c.recipe_id
    LIMIT 1
  `)
  return rows[0]?.recipe_id ?? null
}

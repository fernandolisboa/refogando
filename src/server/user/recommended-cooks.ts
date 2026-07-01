import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { eligiblePublicRecipeSqlFragment } from '@/server/recipe/visibility-sql'
import { DEFAULT_LOCALE } from '@/i18n/locale'
import {
  RECOMMENDED_COOK_RECIPES_LIMIT,
  type RecommendedCook,
  type RecommendedCookRecipe,
} from '@/domain/recommended-cooks-read'
import { projectResult, type SearchHitRow } from '@/domain/recipe-search-read'
import { encodeRecsCursor, type RecsCursor } from '@/domain/cooks-cursor'
import { loadPopularityConfig } from '@/server/app-config'
import { loadGlobalRatingAverage } from '@/server/recipe/popularity'

/** Uma página da Descoberta de Cozinheiros (#308): os cozinheiros + o cursor opaco da PRÓXIMA página
 *  (`null` quando acabou — minado de um probe `limit+1`, NUNCA de `cooks.length < limit`). */
export type RecommendedCooksPage = { cooks: RecommendedCook[]; nextCursor: string | null }

/** Fragmento de filtro de Cozinha (multi, OR-dentro-do-eixo): array VAZIO ⇒ sem filtro (espelha
 *  `server/recipe/search.ts`). `r` é o alias da `recipe` na query do chamador. */
function cozinhaFilterSql(cozinhas: string[]) {
  return sql`(cardinality(${sql.param(cozinhas)}::text[]) = 0 OR r.cozinha = ANY (${sql.param(cozinhas)}::text[]))`
}

/**
 * Loader do trilho "Cozinheiros pra seguir" (#278→#368, ADR-0024/0027/0028) — ranqueia Cozinheiros por
 * POPULARIDADE GLOBAL: a MISTURA (save + nota Bayesiana) do APREÇO DE TERCEIROS às suas receitas PÚBLICAS
 * ELEGÍVEIS, com RECÊNCIA (receita elegível mais nova) como DESEMPATE. v1 não-personalizada (sem boost
 * por gosto/grafo — Camada B deferida). NUNCA realimenta o ranking do feed nem o gate de indexação
 * (módulo SEPARADO; popularidade ≠ autoridade — CONTEXT.md). SEM migração nova: agregação sem índice
 * composto é ACEITA no v1 (tabelas minúsculas); índice deferido.
 *
 * SCORE TIME-INDEPENDENTE (M2): `cookScore = wSave·ln(1+saves) + wNota·bayes(cook_avg, cook_count, C, m)`
 * — SEM termo de frescor aditivo. O `/cooks` PAGINA por keyset `(score, recency, handle)`; um score com
 * `now()` mudaria a cada request e o cozinheiro da borda DUPLICARIA a cada "load more". A recência
 * (`max(created_at)`) fica de DESEMPATE no ORDER BY, realizando "frescor" de forma reproduzível. O score
 * é ARREDONDADO a 6 casas (`round(...::numeric,6)::float8`) — a MESMA precisão no CTE e no cursor, pra a
 * borda do keyset ser reproduzível (senão float64 recomputado divergiria do valor carregado no cursor).
 *
 * CANDIDATO = Cozinheiro com ≥1 receita pública elegível. O `JOIN recipe ON r.owner_id = u.id AND
 * <gate elegível>` exclui POR CONSTRUÇÃO: o catálogo (owner NULL nunca casa a igualdade) e quem só tem
 * privada/playful/moderada/web-imported. Score pode ser o piso `wNota·C` (cozinheiro novo, 0 sinal) —
 * ainda é candidato; a recência flutua o mais novo ao topo do cluster de 0-sinal. O piso de exibição
 * (esconder se < threshold) é decisão de UI (`shouldShowRecommendedRail`); este loader devolve a lista
 * crua até `limit`.
 *
 * AGREGAÇÃO (M4 — sem mean-of-means nem fan-out): CADA fonte é PRÉ-AGREGADA por recipe_id ANTES do join —
 * `sc` (saves) e `rc` (soma+contagem de notas) são subqueries SEPARADAS (uma linha por recipe_id). NUNCA
 * juntar `recipe_save × recipe_review` direto (multiplicaria as linhas). No nível do cozinheiro:
 * `total_saves = sum(sc.saves)`, `cook_count = sum(rc.rcount)`, `cook_avg = sum(rc.rsum)/nullif(sum(rc.rcount),0)`
 * (média VERDADEIRA, não avg-de-avgs). LANDMINES no `rc`: `moderated_at IS NULL` (nota moderada não infla)
 * + `ru.deleted_at IS NULL` (autor soft-deletado fora) + self-exclusão. `sc`/`rc` excluem auto-apreço
 * (`x.user_id <> rr.owner_id`): salvar/avaliar... salvar a PRÓPRIA receita é permitido (social.ts), então
 * sem o filtro um Cozinheiro subiria sozinho apreciando o próprio trabalho (o owner do cozinheiro é
 * não-null ⇒ `<>` direto, sem o ramo NULL do catálogo). C = média global da nota (prior; fallback 3.0).
 *
 * EXCLUSÕES por viewer (só quando LOGADO — `viewerId` definido): o próprio (`u.id <> viewerId`) e quem
 * já segue (`NOT EXISTS` no `user_follow`). As cláusulas só são ANEXADAS com `viewerId` presente — o
 * caminho anônimo/global NUNCA binda NULL (senão `u.id <> NULL` ⇒ NULL ⇒ zera o resultado). `NOT EXISTS`
 * (não `IN`) é à prova de conjunto-vazio (sem o footgun do `IN ()`). Cozinheiro soft-deletado some via
 * `u.deleted_at IS NULL`.
 *
 * GATE DE DADOS (Modelo B / #269): o SELECT projeta SÓ `name/handle/image/recipe_count` — `id` NUNCA sai
 * (a recência sai como `::text` só pro cursor keyset; o score é interno ao ranking), e `email`/`role`
 * jamais entram. `::int`/`::float8` nos agregados garantem number (não a string de um bigint/numeric). A
 * invariante de allowlist é estrutural: o `id` interno não sai do SQL. O score NUNCA entra no DTO cliente.
 *
 * PREVIEW DE RECEITAS (ADR-0024 emendado): cada Cozinheiro carrega ≤ `RECOMMENDED_COOK_RECIPES_LIMIT`
 * receitas (cartão rico do protótipo de telas largas). Resolvido por uma SEGUNDA query (window-function),
 * keyed nos HANDLES públicos já retornados pela query do ranking — assim o `id` interno NUNCA sai do SQL.
 * Anti-fan-out: ≤ N cozinheiros × ≤ 3 receitas = ≤ 24 linhas, sem multiplicar o ranking. O TÍTULO é
 * resolvido em TS (`projectResult`, mesma regra do feed/busca) — NUNCA computado em SQL (um COALESCE
 * inverteria a base original↔pedida). Imagem MODERADA some via `ri.moderated_at IS NULL` no JOIN (o gate
 * de elegibilidade é recipe-level e NÃO cobre a moderação de imagem). GUARD de conjunto-vazio antes da
 * 2ª query (`IN ()` é erro de sintaxe → 500; pool vazio é estado real pré-seed #238).
 */
export async function loadRecommendedCooks(
  db: Database,
  args: {
    viewerId?: string
    limit: number
    requestLocale?: string
    cozinhas?: string[]
    cursor?: RecsCursor | null
  },
): Promise<RecommendedCooksPage> {
  const { viewerId, limit } = args
  const requestLocale = args.requestLocale ?? DEFAULT_LOCALE
  const cozinhas = args.cozinhas ?? []
  const cursor = args.cursor ?? null

  // #368: constantes da mistura + C (média global da nota, prior da Bayesiana). Carregados 1× por
  // request. Fallback 3.0 em TS (número real, NUNCA NULL — senão o CASE ELSE C ⇒ NULL ⇒ NULLS FIRST).
  const cfg = await loadPopularityConfig(db)
  const C = (await loadGlobalRatingAverage(db)) ?? 3.0

  // Exclusões per-viewer SÓ quando logado; anônimo/global NÃO binda NULL (omite as cláusulas).
  const viewerExclusionSql = viewerId
    ? sql`AND u.id <> ${viewerId} AND NOT EXISTS (
        SELECT 1 FROM user_follow uf WHERE uf.follower_id = ${viewerId} AND uf.followee_id = u.id
      )`
    : sql``

  // Keyset all-DESC (#308): a próxima página = o que vem DEPOIS do cursor = a tupla lexicograficamente
  // MENOR. Score/recency são AGREGADOS → o ranking vai numa CTE pra a comparação de linha valer no
  // SELECT externo (não dá pra filtrar agregado no WHERE). Tiebreak = `handle` PÚBLICO (allowlist #269;
  // `u.id` jamais sai da CTE). `recency::timestamptz` casa o cast — o cursor já validou a forma.
  // #368: `score` agora é float8 (arredondado a 6 casas no CTE) — o cursor carrega esse mesmo float e
  // aqui é bindado `::float8` (mesma precisão ⇒ a borda do keyset é reproduzível, sem dup/skip).
  const keysetSql = cursor
    ? sql`(ranked.score, ranked.recency, ranked.handle) < (${cursor.score}::float8, ${cursor.recency}::timestamptz, ${cursor.handle})`
    : sql`TRUE`

  type Row = {
    name: string
    handle: string
    image: string | null
    recipe_count: number
    score: number
    recency_text: string
  }
  // Probe `limit+1`: descobre "tem próxima página?" sem um COUNT (mesma tese do feed/follow.ts).
  const rows = await db.execute<Row>(sql`
    WITH ranked AS (
      SELECT
        u.name AS name,
        u.handle AS handle,
        u.image AS image,
        count(DISTINCT r.id)::int AS recipe_count,
        -- #368: cookScore = wSave*ln(1+total_saves) + wNota*bayes(cook_avg, cook_count, C, m). LANDMINE
        -- math B1: TODA divisão castada a float8 (m/(v+m) inteiro truncaria a 0 e o prior sumiria).
        -- cook_avg = sum(rsum)/nullif(sum(rcount),0) (média VERDADEIRA — M4). round a 6 casas (M2:
        -- reprodutível no keyset). SEM frescor aditivo (a recência é o desempate do ORDER BY, não do score).
        round((
          ${cfg.wSave}::float8 * ln(1 + COALESCE(sum(COALESCE(sc.saves, 0)), 0)::float8)
          + ${cfg.wNota}::float8 * (
              CASE WHEN COALESCE(sum(COALESCE(rc.rcount, 0)), 0) > 0
                THEN (COALESCE(sum(COALESCE(rc.rcount, 0)), 0)::float8
                        / (COALESCE(sum(COALESCE(rc.rcount, 0)), 0)::float8 + ${cfg.m}::float8))
                     * (COALESCE(sum(COALESCE(rc.rsum, 0)), 0)::float8
                        / nullif(COALESCE(sum(COALESCE(rc.rcount, 0)), 0), 0)::float8)
                   + (${cfg.m}::float8
                        / (COALESCE(sum(COALESCE(rc.rcount, 0)), 0)::float8 + ${cfg.m}::float8))
                     * ${C}::float8
                ELSE ${C}::float8
              END
            )
        )::numeric, 6)::float8 AS score,
        max(r.created_at) AS recency
      FROM users u
      JOIN recipe r
        ON r.owner_id = u.id AND ${eligiblePublicRecipeSqlFragment('r')} AND ${cozinhaFilterSql(cozinhas)}
      LEFT JOIN (
        SELECT rf.recipe_id AS recipe_id, count(*)::int AS saves
        FROM recipe_save rf JOIN recipe rr ON rr.id = rf.recipe_id
        WHERE rf.user_id <> rr.owner_id -- exclui auto-save (salvar a própria é permitido; owner não-null ⇒ <> direto)
        GROUP BY rf.recipe_id
      ) sc ON sc.recipe_id = r.id
      LEFT JOIN (
        SELECT rv.recipe_id AS recipe_id, sum(rv.rating)::float8 AS rsum, count(*)::int AS rcount
        FROM recipe_review rv
        JOIN users ru ON ru.id = rv.user_id
        JOIN recipe rr ON rr.id = rv.recipe_id
        WHERE rv.moderated_at IS NULL -- LANDMINE: nota moderada não infla (M3)
          AND ru.deleted_at IS NULL -- autor soft-deletado fora (casa loadAggregate/C)
          AND rv.user_id <> rr.owner_id -- exclui auto-avaliação (owner não-null ⇒ <> direto)
        GROUP BY rv.recipe_id
      ) rc ON rc.recipe_id = r.id
      WHERE u.deleted_at IS NULL
        ${viewerExclusionSql}
      GROUP BY u.id, u.name, u.handle, u.image
    )
    SELECT
      ranked.name AS name,
      ranked.handle AS handle,
      ranked.image AS image,
      ranked.recipe_count AS recipe_count,
      ranked.score AS score,
      ranked.recency::text AS recency_text
    FROM ranked
    WHERE ${keysetSql}
    ORDER BY ranked.score DESC, ranked.recency DESC, ranked.handle DESC
    LIMIT ${limit + 1}
  `)

  const hasMore = rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  // GUARD: página vazia (cursor no fim, ou pool vazio) ⇒ sem 2ª query (também evita `IN ()` inválido).
  if (kept.length === 0) return { cooks: [], nextCursor: null }

  const last = kept[kept.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeRecsCursor({ score: last.score, recency: last.recency_text, handle: last.handle })
      : null

  const recipesByHandle = await loadCookRecipePreviews(
    db,
    kept.map((r) => r.handle),
    requestLocale,
    cozinhas,
  )

  return {
    cooks: kept.map((row) => ({
      name: row.name,
      handle: row.handle,
      image: row.image,
      recipeCount: row.recipe_count,
      recipes: recipesByHandle.get(row.handle) ?? [],
    })),
    nextCursor,
  }
}

/**
 * 2ª query (ADR-0024 emendado): top-N receitas PÚBLICAS ELEGÍVEIS, mais NOVAS primeiro, de CADA Cozinheiro
 * — keyed nos `handles` PÚBLICOS (o `id` interno nunca sai do SQL). `ROW_NUMBER() OVER (PARTITION BY
 * handle ORDER BY created_at DESC, id DESC)` corta no top-3 com desempate determinístico (espelha o feed);
 * o `ORDER BY` externo dá a ordem newest-first DENTRO de cada Cozinheiro. Junta tradução do locale PEDIDO +
 * ORIGINAL (mesma precedência do feed/busca) e a imagem NÃO-moderada; projeta as colunas CRUAS que
 * `projectResult` consome — o título é resolvido em TS (nunca no SQL). Devolve um mapa handle→receitas[],
 * cada lista ≤ 3, na ordem newest-first. Allowlist: NUNCA seleciona owner_id/name/email/role.
 */
async function loadCookRecipePreviews(
  db: Database,
  handles: string[],
  requestLocale: string,
  cozinhas: string[],
): Promise<Map<string, RecommendedCookRecipe[]>> {
  const handleList = sql.join(
    handles.map((h) => sql`${h}`),
    sql`, `,
  )
  // Colunas CRUAS p/ `projectResult` (sem owner_id/name/handle — preenchidos NULL em TS: a allowlist
  // nunca seleciona a identidade do dono; `cook_handle` é só a chave de agrupamento).
  type RecipeRow = {
    cook_handle: string
    recipe_id: string
    origin: SearchHitRow['origin']
    original_locale: string
    requested_titulo: string | null
    requested_provenance: SearchHitRow['requested_provenance']
    original_titulo: string | null
    original_provenance: SearchHitRow['original_provenance']
    slug: string | null
    image_url: string | null
    image_provenance: string | null
  }
  const recipeRows = await db.execute<RecipeRow>(sql`
    WITH ranked AS (
      SELECT
        u.handle AS cook_handle,
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.image_id AS image_id,
        ROW_NUMBER() OVER (PARTITION BY u.handle ORDER BY r.created_at DESC, r.id DESC) AS rn
      FROM users u
      JOIN recipe r
        ON r.owner_id = u.id AND ${eligiblePublicRecipeSqlFragment('r')} AND ${cozinhaFilterSql(cozinhas)}
      WHERE u.handle IN (${handleList}) AND u.deleted_at IS NULL
    )
    SELECT
      ranked.cook_handle AS cook_handle,
      ranked.recipe_id AS recipe_id,
      ranked.origin AS origin,
      ranked.original_locale AS original_locale,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      req_t.slug AS slug,
      ri.blob_url AS image_url,
      ri.provenance AS image_provenance
    FROM ranked
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = ranked.recipe_id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = ranked.recipe_id AND orig_t.locale = ranked.original_locale
    LEFT JOIN recipe_image ri
      ON ri.id = ranked.image_id AND ri.moderated_at IS NULL -- imagem moderada some (gate fora do elegível)
    WHERE ranked.rn <= ${RECOMMENDED_COOK_RECIPES_LIMIT}
    ORDER BY ranked.cook_handle, ranked.rn
  `)

  const byHandle = new Map<string, RecommendedCookRecipe[]>()
  for (const row of recipeRows) {
    // `projectResult` resolve título/imagem/slug com a MESMA regra do feed/busca. owner_* = NULL ⇒
    // `isOwn=false` e sem `author` (a identidade do dono nunca entra na receita embutida); `section` é
    // SQL-internal (nunca lida em TS). Sem tradução exibível ⇒ `null` (receita sem título sai do preview).
    const hit: SearchHitRow = {
      recipe_id: row.recipe_id,
      origin: row.origin,
      original_locale: row.original_locale,
      requested_titulo: row.requested_titulo,
      requested_provenance: row.requested_provenance,
      original_titulo: row.original_titulo,
      original_provenance: row.original_provenance,
      section: 'comunidade',
      owner_id: null,
      owner_name: null,
      owner_handle: null,
      image_url: row.image_url,
      image_provenance: row.image_provenance,
      slug: row.slug,
    }
    const projected = projectResult(hit, requestLocale)
    if (projected === null) continue
    const preview: RecommendedCookRecipe = {
      recipeId: projected.recipeId,
      displayedTitle: projected.displayedTitle,
      ...(projected.slug !== undefined ? { slug: projected.slug } : {}),
      ...(projected.imageUrl !== undefined ? { imageUrl: projected.imageUrl } : {}),
      ...(projected.imageAiGenerated !== undefined
        ? { imageAiGenerated: projected.imageAiGenerated }
        : {}),
    }
    const list = byHandle.get(row.cook_handle)
    if (list) list.push(preview)
    else byHandle.set(row.cook_handle, [preview])
  }
  return byHandle
}

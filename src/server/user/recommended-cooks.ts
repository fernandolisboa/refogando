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

/**
 * Loader do trilho "Cozinheiros pra seguir" (#278, ADR-0024) — ranqueia Cozinheiros por POPULARIDADE
 * GLOBAL: o APREÇO DE TERCEIROS (votos + favoritos de OUTROS) às suas receitas PÚBLICAS ELEGÍVEIS, com
 * RECÊNCIA (receita elegível mais nova) como DESEMPATE. v1 não-personalizada (sem boost por gosto/grafo
 * — Camada B deferida). NUNCA realimenta o ranking do feed nem o gate de indexação (módulo SEPARADO;
 * popularidade ≠ autoridade — CONTEXT.md). SEM migração: agregação sem índice composto é ACEITA no v1
 * (tabelas minúsculas), mesma filosofia do cursor do feed; índice deferido (vira #279/futuro).
 *
 * CANDIDATO = Cozinheiro com ≥1 receita pública elegível. O `JOIN recipe ON r.owner_id = u.id AND
 * <gate elegível>` exclui POR CONSTRUÇÃO: o catálogo (owner NULL nunca casa a igualdade) e quem só tem
 * privada/playful/moderada/web-imported. Score PODE ser 0 (cozinheiro novo, sem votos ainda) — ainda é
 * candidato, ordenado depois dos com score positivo. O piso de exibição (esconder se < threshold) é
 * decisão de UI (`shouldShowRecommendedRail`); este loader devolve a lista crua até `limit`.
 *
 * APREÇO DE TERCEIROS: os sub-selects `vc`/`fc` PRÉ-AGREGAM votos/favoritos POR receita (uma linha por
 * recipe_id) ANTES do LEFT JOIN — sem isso, juntar as duas tabelas-detalhe direto multiplicaria as
 * linhas (fan-out votos×favoritos) e inflaria o score. Ambos excluem auto-apreço (`x.user_id <>
 * rr.owner_id`): favoritar a PRÓPRIA receita é permitido (social.ts), então sem o filtro um Cozinheiro
 * subiria sozinho favoritando o próprio trabalho. Votos já são auto-livres no write-path; o filtro
 * espelhado é cinto-e-suspensório e deixa a intenção ("apreço de terceiros") explícita no SQL.
 *
 * EXCLUSÕES por viewer (só quando LOGADO — `viewerId` definido): o próprio (`u.id <> viewerId`) e quem
 * já segue (`NOT EXISTS` no `user_follow`). As cláusulas só são ANEXADAS com `viewerId` presente — o
 * caminho anônimo/global NUNCA binda NULL (senão `u.id <> NULL` ⇒ NULL ⇒ zera o resultado). `NOT EXISTS`
 * (não `IN`) é à prova de conjunto-vazio (sem o footgun do `IN ()`). Cozinheiro soft-deletado some via
 * `u.deleted_at IS NULL`.
 *
 * GATE DE DADOS (Modelo B / #269): o SELECT projeta SÓ `name/handle/image/recipe_count` — `id`, o score
 * e a recência são EXPRESSÕES de ORDER BY (nunca selecionadas), e `email`/`role` jamais entram. `::int`
 * nos agregados garante number (não a string de um bigint). A invariante de allowlist é estrutural: o
 * `id` interno não sai do SQL.
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
  args: { viewerId?: string; limit: number; requestLocale?: string },
): Promise<RecommendedCook[]> {
  const { viewerId, limit } = args
  const requestLocale = args.requestLocale ?? DEFAULT_LOCALE

  // Exclusões per-viewer SÓ quando logado; anônimo/global NÃO binda NULL (omite as cláusulas).
  const viewerExclusionSql = viewerId
    ? sql`AND u.id <> ${viewerId} AND NOT EXISTS (
        SELECT 1 FROM user_follow uf WHERE uf.follower_id = ${viewerId} AND uf.followee_id = u.id
      )`
    : sql``

  type Row = { name: string; handle: string; image: string | null; recipe_count: number }
  const rows = await db.execute<Row>(sql`
    SELECT
      u.name AS name,
      u.handle AS handle,
      u.image AS image,
      count(DISTINCT r.id)::int AS recipe_count
    FROM users u
    JOIN recipe r ON r.owner_id = u.id AND ${eligiblePublicRecipeSqlFragment('r')}
    LEFT JOIN (
      SELECT rv.recipe_id AS recipe_id, count(*)::int AS c
      FROM recipe_vote rv JOIN recipe rr ON rr.id = rv.recipe_id
      WHERE rv.user_id <> rr.owner_id -- apreço de TERCEIROS (auto-voto já barrado no write-path)
      GROUP BY rv.recipe_id
    ) vc ON vc.recipe_id = r.id
    LEFT JOIN (
      SELECT rf.recipe_id AS recipe_id, count(*)::int AS c
      FROM recipe_favorite rf JOIN recipe rr ON rr.id = rf.recipe_id
      WHERE rf.user_id <> rr.owner_id -- exclui auto-favorito (favoritar a própria é permitido)
      GROUP BY rf.recipe_id
    ) fc ON fc.recipe_id = r.id
    WHERE u.deleted_at IS NULL
      ${viewerExclusionSql}
    GROUP BY u.id, u.name, u.handle, u.image
    ORDER BY
      (COALESCE(sum(COALESCE(vc.c, 0)), 0) + COALESCE(sum(COALESCE(fc.c, 0)), 0)) DESC,
      max(r.created_at) DESC,
      u.id DESC
    LIMIT ${limit}
  `)

  // GUARD: pool vazio ⇒ retorna já (também evita `IN ()` inválido na 2ª query).
  if (rows.length === 0) return []

  const recipesByHandle = await loadCookRecipePreviews(
    db,
    rows.map((r) => r.handle),
    requestLocale,
  )

  return rows.map((row) => ({
    name: row.name,
    handle: row.handle,
    image: row.image,
    recipeCount: row.recipe_count,
    recipes: recipesByHandle.get(row.handle) ?? [],
  }))
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
      JOIN recipe r ON r.owner_id = u.id AND ${eligiblePublicRecipeSqlFragment('r')}
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

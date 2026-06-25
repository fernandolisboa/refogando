import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { eligiblePublicRecipeSqlFragment } from '@/server/recipe/visibility-sql'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

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
 */
export async function loadRecommendedCooks(
  db: Database,
  args: { viewerId?: string; limit: number },
): Promise<RecommendedCook[]> {
  const { viewerId, limit } = args

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

  return rows.map((row) => ({
    name: row.name,
    handle: row.handle,
    image: row.image,
    recipeCount: row.recipe_count,
  }))
}

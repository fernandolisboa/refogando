import { and, eq, isNull } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe, recipeTranslation } from '@/db/schema'
import { communityVisibleCondition } from '@/server/recipe/visibility-filter'

/**
 * Lista de traduções obsoletas para o Curador (issue #23, AC2.2). SÓ traduções `stale`
 * de receitas da COMUNIDADE (pública OU owner_id NULL) — uma tradução stale de receita
 * PRIVADA de usuário é EXCLUÍDA (não vaza id/locale/proveniência de conteúdo privado;
 * isso é #18, must-fix de escopo ADR-0011). O filtro de comunidade espelha `search.ts`
 * (`owner_id IS NULL OR visibility = 'public'`).
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador (`moderation_removed_at`) saiu
 * do pool SEM tocar `visibility` (AC3) — então também sai DESTA fila (senão a tradução de
 * uma Receita já moderada seguiria listada). Espelha o gate de pool de `recipe-pool.ts`
 * (faltar UM gate = vaza Receita removida); o predicado completo de pool não cabe aqui
 * (esta fila lista também Catálogo + ignora playful), mas a cláusula de moderação é a mesma.
 *
 * Devolve só id+locale+proveniência (nada de conteúdo sensível). Sem paginação (fora de
 * escopo). Age por PAPEL: Visitante ⇒ 401; usuario ⇒ 403; curador/admin ⇒ 200.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const rows = await getDb()
    .select({
      recipeId: recipeTranslation.recipeId,
      locale: recipeTranslation.locale,
      provenance: recipeTranslation.provenance,
    })
    .from(recipeTranslation)
    .innerJoin(recipe, eq(recipe.id, recipeTranslation.recipeId))
    .where(
      and(
        eq(recipeTranslation.stale, true),
        communityVisibleCondition(recipe),
        // #18: exclui Receita removida do pool pela moderação (recipe-pool.ts).
        isNull(recipe.moderationRemovedAt),
      ),
    )
    .orderBy(recipeTranslation.recipeId, recipeTranslation.locale)

  return Response.json({ stale: rows }, { status: 200 })
}

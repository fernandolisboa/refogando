import { and, eq, or, isNull } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe, recipeTranslation } from '@/db/schema'

/**
 * Lista de traduções obsoletas para o Curador (issue #23, AC2.2). SÓ traduções `stale`
 * de receitas da COMUNIDADE (pública OU owner_id NULL) — uma tradução stale de receita
 * PRIVADA de usuário é EXCLUÍDA (não vaza id/locale/proveniência de conteúdo privado;
 * isso é #18, must-fix de escopo ADR-0011). O filtro de comunidade espelha `search.ts`
 * (`owner_id IS NULL OR visibility = 'public'`).
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
        or(isNull(recipe.ownerId), eq(recipe.visibility, 'public')),
      ),
    )
    .orderBy(recipeTranslation.recipeId, recipeTranslation.locale)

  return Response.json({ stale: rows }, { status: 200 })
}

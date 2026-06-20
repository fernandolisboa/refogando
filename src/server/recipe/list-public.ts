import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation } from '@/db/schema'
import type { ProfileRecipeRow } from '@/domain/recipe-profile-read'
import type { TranslationRow } from '@/domain/recipe-read'

/**
 * Loader das Receitas PÚBLICAS de um dono (#129) — alimenta o perfil público `/u/<handle>`.
 * Carrega SÓ o que está no POOL daquele dono: `owner_id = ownerId` AND `visibility = 'public'`
 * AND `result_kind <> 'playful'` AND `moderation_removed_at IS NULL`.
 *
 * GATE DE POOL (fonte única, #18 — recipe-pool.ts): replica o predicado `eligibleForPool` para
 * o sub-conjunto com dono (aqui `owner_id` é SEMPRE não-NULL — escopado a um dono específico),
 * então a regra colapsa em `visibility = 'public' AND result_kind <> 'playful' AND
 * moderation_removed_at IS NULL`. Privadas e removidas-do-pool NUNCA aparecem (AC: o perfil
 * público jamais vaza o privado de ninguém — nem do próprio dono visto por terceiro).
 *
 * Espelha `listMyRecipes` (#61) na ESTRUTURA (duas queries: espinha + traduções num IN, agrupa
 * em memória), mas o GATE é o OPOSTO: lá o dono vê TUDO que é seu (sem gate de pool); aqui um
 * Visitante vê SÓ o pool público — o gate de pool É a fronteira de segurança.
 *
 * Mais novas primeiro (`created_at DESC, id DESC`) — espelha a ordem cronológica do Feed.
 */
export async function listPublicRecipesByOwner(
  db: Database,
  ownerId: string,
): Promise<ProfileRecipeRow[]> {
  const rows = await db
    .select({
      id: recipe.id,
      origin: recipe.origin,
      originalLocale: recipe.originalLocale,
    })
    .from(recipe)
    .where(
      and(
        eq(recipe.ownerId, ownerId),
        // Gate de pool (#18) para receitas com dono: pública + não-playful + não-removida.
        eq(recipe.visibility, 'public'),
        sql`${recipe.resultKind} <> 'playful'`,
        isNull(recipe.moderationRemovedAt),
      ),
    )
    .orderBy(desc(recipe.createdAt), desc(recipe.id))

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const translations = await db
    .select({
      recipeId: recipeTranslation.recipeId,
      locale: recipeTranslation.locale,
      titulo: recipeTranslation.titulo,
      descricao: recipeTranslation.descricao,
      passos: recipeTranslation.passos,
      notas: recipeTranslation.notas,
      provenance: recipeTranslation.provenance,
      stale: recipeTranslation.stale,
    })
    .from(recipeTranslation)
    .where(inArray(recipeTranslation.recipeId, ids))

  // Agrupa as traduções por receita (ausente ⇒ []; resolveName cai no fallback / item pulado).
  const byRecipe = new Map<string, TranslationRow[]>()
  for (const t of translations) {
    const list = byRecipe.get(t.recipeId) ?? []
    list.push({
      locale: t.locale,
      titulo: t.titulo,
      descricao: t.descricao,
      passos: t.passos,
      notas: t.notas,
      provenance: t.provenance,
      stale: t.stale,
    })
    byRecipe.set(t.recipeId, list)
  }

  return rows.map((r) => ({
    id: r.id,
    origin: r.origin,
    originalLocale: r.originalLocale,
    translations: byRecipe.get(r.id) ?? [],
  }))
}

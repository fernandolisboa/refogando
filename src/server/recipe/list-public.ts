import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, recipeTranslation } from '@/db/schema'
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
 * moderation_removed_at IS NULL AND origin <> 'web_imported'`. Privadas e removidas-do-pool NUNCA
 * aparecem (AC: o perfil público jamais vaza o privado de ninguém — nem do próprio dono visto por
 * terceiro). O `origin <> 'web_imported'` (#168/ADR-0019) é DEFENSE-IN-DEPTH alinhado ao
 * `eligibleForPool` canônico — uma importada da web nunca entra no pool nem que vaze para `public`;
 * agora que o perfil EXPÕE a foto de capa, manter o loader honesto ao próprio doc importa mais.
 *
 * IMAGEM (#130/#132): LEFT JOIN em `recipe_image` via `recipe.image_id`, com `moderated_at IS NULL`
 * na cláusula ON (#133, espelha `feed.ts`/`search.ts`) — imagem moderada some do público SEM sumir a
 * receita. Projeta SÓ o `blob_url` PÚBLICO + `provenance` (crus); a derivação `imageUrl`/
 * `imageAiGenerated` é PURA no `projectProfileRecipe`. NUNCA o `image_id` interno.
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
      // Foto de capa (#130/#132): blob PÚBLICO + proveniência da thumbnail. NULL sem imagem ou com
      // imagem MODERADA (o gate moderated_at IS NULL vive na cláusula ON do JOIN, não no WHERE).
      imageUrl: recipeImage.blobUrl,
      imageProvenance: recipeImage.provenance,
    })
    .from(recipe)
    // #133: imagem moderada some do público pelo gate na cláusula ON (não some a receita).
    .leftJoin(
      recipeImage,
      and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)),
    )
    .where(
      and(
        eq(recipe.ownerId, ownerId),
        // Gate de pool (#18) para receitas com dono: pública + não-playful + não-removida.
        eq(recipe.visibility, 'public'),
        sql`${recipe.resultKind} <> 'playful'`,
        isNull(recipe.moderationRemovedAt),
        // #168/ADR-0019: web_imported NUNCA entra no pool (defense-in-depth, espelha eligibleForPool).
        sql`${recipe.origin} <> 'web_imported'`,
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
      // Slug por idioma (#231, ADR-0020): projetado pra montar o link canônico do card. O loader é
      // locale-agnóstico — devolve `slugByLocale` e o builder escolhe pelo requestLocale.
      slug: recipeTranslation.slug,
    })
    .from(recipeTranslation)
    .where(inArray(recipeTranslation.recipeId, ids))

  // Agrupa as traduções por receita (ausente ⇒ []; resolveName cai no fallback / item pulado).
  // Em paralelo, colhe os slugs por idioma (#231): `{ locale → slug }` só dos não-NULL.
  const byRecipe = new Map<string, TranslationRow[]>()
  const slugsByRecipe = new Map<string, Record<string, string>>()
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
    if (t.slug != null) {
      const map = slugsByRecipe.get(t.recipeId) ?? {}
      map[t.locale] = t.slug
      slugsByRecipe.set(t.recipeId, map)
    }
  }

  return rows.map((r) => {
    const slugByLocale = slugsByRecipe.get(r.id)
    return {
      id: r.id,
      origin: r.origin,
      originalLocale: r.originalLocale,
      ...(slugByLocale ? { slugByLocale } : {}),
      // CRUS do LEFT JOIN (nullable): a derivação imageUrl/imageAiGenerated é PURA no projetor.
      imageUrl: r.imageUrl,
      imageProvenance: r.imageProvenance,
      translations: byRecipe.get(r.id) ?? [],
    }
  })
}

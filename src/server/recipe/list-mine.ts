import { and, eq, desc, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, recipeTranslation } from '@/db/schema'
import { resolveRecipeListItem, type RecipeListItem } from '@/domain/recipe-list-read'
import type { TranslationRow } from '@/domain/recipe-read'

/**
 * Loader de servidor de "Minhas criações" (issue #61). Carrega TODAS as Receitas do dono
 * (`owner_id = ownerId`), mais novas primeiro (`updated_at DESC`), com as traduções para
 * resolver o título exibido, e delega a montagem ao módulo PURO `resolveRecipeListItem`.
 *
 * INVARIANTE CONGELADA (#61): NENHUM filtro de pool/moderação/visibilidade. O dono vê TUDO
 * que é seu — private, playful E removida-do-pool (moderation_removed_at). NÃO reusa nenhum
 * gate de `recipe-pool.ts` (aquele é para a leitura PÚBLICA; aqui a própria escopagem por
 * `owner_id` é a fronteira de segurança — o route já provou a sessão e só passa o id do
 * próprio caller, então a query nunca vaza Receita alheia).
 *
 * Catálogo (`owner_id IS NULL`) NUNCA casa `eq(owner_id, ownerId)` ⇒ fica de fora por
 * construção (catálogo não é "criação" de ninguém).
 *
 * Duas queries (não um JOIN que infla linhas por tradução): (1) as Receitas do dono;
 * (2) as traduções dessas Receitas num `IN (...)`. Agrupa as traduções por receita em
 * memória e projeta cada item. `updated_at` sai como ISO string (o cliente só exibe/ordena).
 */
export async function listMyRecipes(
  db: Database,
  input: { ownerId: string; requestLocale: string; fallbackName: string },
): Promise<RecipeListItem[]> {
  const { ownerId, requestLocale, fallbackName } = input

  const rows = await db
    .select({
      id: recipe.id,
      origin: recipe.origin,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      lineageKind: recipe.lineageKind,
      originalLocale: recipe.originalLocale,
      updatedAt: recipe.updatedAt,
      moderationRemovedAt: recipe.moderationRemovedAt,
      // Imagem (#130/#206): LEFT JOIN da thumbnail com o gate público `moderated_at IS NULL`
      // (espelha feed.ts/#133). Sem casamento (sem imagem ou imagem moderada) ⇒ NULL ⇒ placeholder.
      imageUrl: recipeImage.blobUrl,
      // Proveniência da imagem (#216): `recipe_image.provenance` da thumbnail (NULL sem imagem).
      // `resolveRecipeListItem` deriva o booleano `imageAiGenerated` (selo "✨ gerada por IA").
      imageProvenance: recipeImage.provenance,
    })
    .from(recipe)
    .leftJoin(
      recipeImage,
      and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)),
    )
    .where(eq(recipe.ownerId, ownerId))
    .orderBy(desc(recipe.updatedAt), desc(recipe.id))

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

  // Agrupa as traduções por receita (ausente ⇒ []; resolveName cai no fallback).
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

  return rows.map((r) =>
    resolveRecipeListItem(
      {
        id: r.id,
        origin: r.origin,
        visibility: r.visibility,
        resultKind: r.resultKind,
        lineageKind: r.lineageKind,
        originalLocale: r.originalLocale,
        updatedAt: r.updatedAt.toISOString(),
        // `moderation_removed_at NÃO NULL` ⇒ saiu do acervo público (a SELECT-projection é a
        // única mudança; sem migração — a coluna já existe no schema).
        moderationRemovida: r.moderationRemovedAt != null,
        imageUrl: r.imageUrl ?? undefined,
        imageProvenance: r.imageProvenance ?? undefined,
        translations: byRecipe.get(r.id) ?? [],
      },
      requestLocale,
      fallbackName,
    ),
  )
}

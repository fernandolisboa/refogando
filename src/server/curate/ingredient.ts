import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ingredient, ingredientTranslation } from '@/db/schema'
import { normalizeText } from '@/domain/recipe-restrictions'
import { pgCode } from '@/server/recipe/visibility'

/**
 * Base canônica de Ingrediente — criar/ajustar pelo Curador (issue #19, AC3/AC4).
 *
 * ORTOGONAL ao ciclo de tradução de receita: edits de nome/alias/alérgeno NUNCA cabeiam
 * `applyEdit`/`embedTranslation` (ingrediente não tem stale/embedding).
 *
 * Normalização: SÓ `alergenos` é normalizado na escrita (`normalizeText`:
 * NFD+sem-acento+lowercase+trim) — é chave de igualdade do motor de Aviso (#7), que
 * normaliza na LEITURA mas se beneficia da higiene de armazenamento + consistência
 * cross-locale. `nome`/`aliases` ficam em SURFACE FORM (a busca de #9 normaliza no SQL ao
 * vivo — ex. 'cebola-roxa' hifenizado, 'limão' acentuado).
 */

export type IngredientTranslationInput = { locale: string; nome: string; aliases?: string[] | null }

/** Normaliza tokens de alérgeno (lower+sem-acento+trim) e descarta vazios. */
export function normalizeAllergens(tokens: string[]): string[] {
  return tokens.map(normalizeText).filter((t) => t.length > 0)
}

/**
 * Cria um Ingrediente canônico + traduções (≥1, garantido pela borda). `slug` opcional
 * (NULL não conflita — múltiplos NULL permitidos sob `ingredient_slug_uq`). 23505 do slug
 * (lido via `pgCode` — sob Drizzle o PostgresError vem em `err.cause.code`) ⇒
 * discriminator 'slug_em_uso' (route mapeia 409). PRÉ-CONDIÇÃO: `translations` não-vazio.
 */
export async function createIngredient(
  db: Database,
  input: { slug?: string | null; alergenos?: string[]; translations: IngredientTranslationInput[] },
): Promise<{ id: string } | 'slug_em_uso'> {
  try {
    return await db.transaction(async (tx) => {
      const [ing] = await tx
        .insert(ingredient)
        .values({
          slug: input.slug ?? null,
          alergenos: input.alergenos ? normalizeAllergens(input.alergenos) : null,
        })
        .returning({ id: ingredient.id })

      await tx.insert(ingredientTranslation).values(
        input.translations.map((t) => ({
          ingredientId: ing.id,
          locale: t.locale,
          nome: t.nome,
          aliases: t.aliases ?? null,
        })),
      )

      return { id: ing.id }
    })
  } catch (err) {
    if (pgCode(err) === '23505') return 'slug_em_uso'
    throw err
  }
}

/**
 * Atualiza um canônico: `alergenos` (normalizado, se presente) e upsert de tradução
 * por-locale (`onConflictDoUpdate` em (ingredientId, locale) — `ingredient_translation_
 * ingredient_locale_uq`): locale existente ⇒ UPDATE de nome/aliases; locale novo ⇒
 * INSERT. `translations` é OPCIONAL no update (editar só alérgeno é válido). `aliases`
 * full-array-replace. Devolve `false` se o ingrediente não existe (route mapeia 404).
 * O UPDATE de alérgeno + o loop de upsert rodam numa ÚNICA `transaction` (igual
 * `createIngredient`): falha no meio reverte tudo — sem escrita parcial.
 */
export async function updateIngredient(
  db: Database,
  input: { id: string; alergenos?: string[]; translations?: IngredientTranslationInput[] },
): Promise<boolean> {
  const [exists] = await db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.id, input.id))
  if (!exists) return false

  // Tudo num só `transaction` (igual `createIngredient`): o UPDATE de alérgenos + os upserts
  // de tradução por-locale compartilham a MESMA tx, então uma falha no meio (ex. constraint
  // num locale posterior) REVERTE o alérgeno e os upserts anteriores — sem escrita parcial.
  await db.transaction(async (tx) => {
    if (input.alergenos !== undefined) {
      await tx
        .update(ingredient)
        .set({ alergenos: normalizeAllergens(input.alergenos) })
        .where(eq(ingredient.id, input.id))
    }

    if (input.translations !== undefined) {
      for (const t of input.translations) {
        await tx
          .insert(ingredientTranslation)
          .values({ ingredientId: input.id, locale: t.locale, nome: t.nome, aliases: t.aliases ?? null })
          .onConflictDoUpdate({
            target: [ingredientTranslation.ingredientId, ingredientTranslation.locale],
            set: { nome: t.nome, aliases: t.aliases ?? null },
          })
      }
    }
  })

  return true
}

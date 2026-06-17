import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipe, recipeTranslation } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Identidade language-neutral (issue #23, AC5): a Receita NÃO bifurca por locale. O 2º
 * locale é uma LINHA de `recipe_translation`, nunca uma nova `recipe`. O invariante já
 * vive no schema (recipe PK neutra + uniqueIndex recipe_translation_recipe_locale_uq);
 * este teste o TRAVA. Duplicata (recipe_id, locale) ⇒ 23505 (via makeSql cru — `.code`
 * no TOPO; sob Drizzle viria em `err.cause.code`).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('identidade language-neutral #23 (AC5)', () => {
  it('2º locale é LINHA de recipe_translation, nunca nova recipe (recipe=1, translation=2)', async () => {
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId, locale: 'en-US', titulo: 'Black Bean Stew', provenance: 'automatica_revisada' })

    const recipes = await db.select({ id: recipe.id }).from(recipe).where(eq(recipe.id, recipeId))
    const translations = await db
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, recipeId))
    expect(recipes).toHaveLength(1)
    expect(translations).toHaveLength(2)
    expect(translations.map((t) => t.locale).sort()).toEqual(['en-US', 'pt-BR'])
  })

  it('duplicata (recipe_id, locale) ⇒ PostgresError 23505 (UNIQUE)', async () => {
    const [rec] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, owner_id, visibility, result_kind)
      VALUES ('catalog','pt-BR',NULL,'private','success') RETURNING id
    `
    await sql`
      INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance)
      VALUES (${rec.id}, 'en-US', 'Cake', 'automatica_revisada')
    `
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance)
        VALUES (${rec.id}, 'en-US', 'Cake again', 'automatica_revisada')
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23505')
  })
})

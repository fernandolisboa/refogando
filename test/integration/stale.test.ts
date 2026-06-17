import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { applyStaleDecision } from '@/server/recipe/stale'
import { decideStale } from '@/domain/stale-rule'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'

/**
 * applyStaleDecision (issue #14): EFEITO da regra de obsolescência de #3. Marca stale nas
 * traduções+embeddings dos locales decididos, numa transação, vinculados ao recipeId.
 * Extrai o que estava inline em recipe-constraints.test.ts para um helper reutilizável.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function seedRecipeWithBothLocales(): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
  await seedTranslation({
    recipeId,
    locale: 'en-US',
    titulo: 'Black Bean Stew',
    provenance: 'automatica_revisada',
  })
  await seedEmbedding({ recipeId, locale: 'pt-BR' })
  await seedEmbedding({ recipeId, locale: 'en-US' })
  return recipeId
}

describe('applyStaleDecision #14', () => {
  it('marca stale só do locale decidido (pt-BR), vinculado ao recipeId', async () => {
    const db = getDb()
    const recipeId = await seedRecipeWithBothLocales()
    const decision = decideStale({ changedFields: ['titulo'], locale: 'pt-BR' })
    expect(decision).toEqual({ staleTranslations: ['pt-BR'], staleEmbeddings: ['pt-BR'] })

    await applyStaleDecision(db, recipeId, decision)

    const tr = await db
      .select({ locale: recipeTranslation.locale, stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, recipeId))
    const em = await db
      .select({ locale: recipeEmbedding.locale, stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(eq(recipeEmbedding.recipeId, recipeId))
    expect(tr.find((r) => r.locale === 'pt-BR')?.stale).toBe(true)
    expect(tr.find((r) => r.locale === 'en-US')?.stale).toBe(false)
    expect(em.find((r) => r.locale === 'pt-BR')?.stale).toBe(true)
    expect(em.find((r) => r.locale === 'en-US')?.stale).toBe(false)
  })

  it('decisão vazia (só campos invariantes) é no-op — nada vira stale', async () => {
    const db = getDb()
    const recipeId = await seedRecipeWithBothLocales()
    const decision = decideStale({ changedFields: ['quantidade'], locale: 'pt-BR' })
    expect(decision).toEqual({ staleTranslations: [], staleEmbeddings: [] })

    await applyStaleDecision(db, recipeId, decision)

    const [tr] = await db
      .select({ stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'pt-BR')))
    const [em] = await db
      .select({ stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(tr.stale).toBe(false)
    expect(em.stale).toBe(false)
  })
})

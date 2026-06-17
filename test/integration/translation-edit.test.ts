import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder, type Embedder } from '@/server/embedding/embedder'
import { applyEdit } from '@/server/recipe/edit'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'

/**
 * Helper edit-time `applyEdit` (issue #23, C7) — AC6 (campo invariante NÃO marca stale, sem
 * re-embed) + caminho traduzível (marca stale do locale + re-embeda). Cabeia decideStale (#3)
 * → applyStaleDecision (#14) → embedTranslation (#14). Conta as chamadas ao embedder via um
 * dublê-spy (envolve FakeEmbedder(1536)).
 */

const DIM = 1536

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Embedder-spy: conta chamadas e delega ao FakeEmbedder(1536). */
class CountingEmbedder implements Embedder {
  calls = 0
  private readonly inner = new FakeEmbedder(DIM)
  async embed(text: string): Promise<number[]> {
    this.calls++
    return this.inner.embed(text)
  }
}

async function seedBothLocalesEmbedded(): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Feijoada', descricao: 'X', provenance: 'escrita_por_pessoa' })
  await seedTranslation({ recipeId, locale: 'en-US', titulo: 'Black Bean Stew', descricao: 'Y', provenance: 'automatica_revisada' })
  await seedEmbedding({ recipeId, locale: 'pt-BR' })
  await seedEmbedding({ recipeId, locale: 'en-US' })
  return recipeId
}

describe('applyEdit #23 — AC6 (campo invariante é no-op)', () => {
  it('changedFields:[quantidade] ⇒ nada vira stale, embedder NÃO chamado', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const db = getDb()
    const recipeId = await seedBothLocalesEmbedded()

    await applyEdit(db, { recipeId, locale: 'pt-BR', changedFields: ['quantidade'] })

    expect(spy.calls).toBe(0) // sem re-embed
    const trs = await db
      .select({ locale: recipeTranslation.locale, stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, recipeId))
    expect(trs.every((t) => t.stale === false)).toBe(true)
    const ems = await db
      .select({ locale: recipeEmbedding.locale, stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(eq(recipeEmbedding.recipeId, recipeId))
    expect(ems.every((e) => e.stale === false)).toBe(true)
  })
})

describe('applyEdit #23 — caminho traduzível', () => {
  it('changedFields:[titulo] ⇒ marca stale do locale + re-embeda (embedding stale=false)', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const db = getDb()
    const recipeId = await seedBothLocalesEmbedded()

    await applyEdit(db, { recipeId, locale: 'pt-BR', changedFields: ['titulo'] })

    // embedder chamado exatamente uma vez (só o locale editado).
    expect(spy.calls).toBe(1)

    // A tradução pt-BR fica stale (marcada por applyStaleDecision; o recompute NÃO limpa a
    // flag da tradução, só a do embedding).
    const [trPt] = await db
      .select({ stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'pt-BR')))
    expect(trPt.stale).toBe(true)

    // O embedding pt-BR foi recomputado ⇒ stale=false (limpo no sucesso do recompute).
    const [emPt] = await db
      .select({ stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(emPt.stale).toBe(false)
  })

  it('só o locale editado é tocado, nunca espalha', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const db = getDb()
    const recipeId = await seedBothLocalesEmbedded()

    await applyEdit(db, { recipeId, locale: 'pt-BR', changedFields: ['titulo'] })

    // en-US intocada (tradução e embedding).
    const [trEn] = await db
      .select({ stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(trEn.stale).toBe(false)
    const [emEn] = await db
      .select({ stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'en-US')))
    expect(emEn.stale).toBe(false)
  })
})

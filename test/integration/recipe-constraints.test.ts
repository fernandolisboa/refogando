import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import { decideStale } from '@/domain/stale-rule'
import { SCHEMA_VERSION_RECEITA } from '@/domain/recipe'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'

/**
 * Invariantes do banco da espinha da Receita (issue #3). Constraint-violations são
 * dirigidas por um cliente RAW postgres-js — só assim o PostgresError carrega `.code`
 * no TOPO (sob Drizzle o código viria em `(err.cause as PostgresError).code`). Modelo:
 * foundation-db.test.ts. PKs são uuid não-determinístico — sempre asserir por id RETORNADO.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('Receita: invariantes de banco', () => {
  it('AC#6a: CHECK recipe_playful_private_chk ⇒ SQLSTATE 23514 (playful + public)', async () => {
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe (origin, original_locale, result_kind, visibility)
        VALUES ('catalog', 'pt-BR', 'playful', 'public')
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23514')
  })

  it('#450: CHECK recipe_web_imported_private_chk ⇒ 23514 (web_imported + public); private SUCEDE', async () => {
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe (origin, original_locale, visibility)
        VALUES ('web_imported', 'pt-BR', 'public')
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23514')

    // web_imported + private passa (o invariante permite a cópia privada do usuário).
    const ok = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, visibility)
      VALUES ('web_imported', 'pt-BR', 'private')
      RETURNING id
    `
    expect(ok).toHaveLength(1)
  })

  it('AC#6b: trigger origin imutável ⇒ SQLSTATE P0001; update não-origin SUCEDE', async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale)
      VALUES ('catalog', 'pt-BR')
      RETURNING id
    `
    const id = row.id

    let err: unknown
    try {
      await sql`UPDATE recipe SET origin = 'ai_chat' WHERE id = ${id}`
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('P0001')

    // Update que NÃO toca origin passa pelo trigger sem erro.
    const updated = await sql<{ id: string }[]>`
      UPDATE recipe SET visibility = 'public' WHERE id = ${id} RETURNING id
    `
    expect(updated).toHaveLength(1)
  })

  it('AC#7: DELETE do pai ⇒ filho sobrevive com parent_recipe_id NULL e origin intacto', async () => {
    const [parent] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale)
      VALUES ('catalog', 'pt-BR')
      RETURNING id
    `
    const [child] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, parent_recipe_id, lineage_kind)
      VALUES ('ai_chat', 'pt-BR', ${parent.id}, 'regenerated')
      RETURNING id
    `
    const parentId = parent.id
    const childId = child.id

    await sql`DELETE FROM recipe WHERE id = ${parentId}`

    const rows = await sql<{ id: string; parent_recipe_id: string | null; origin: string }[]>`
      SELECT id, parent_recipe_id, origin FROM recipe WHERE id = ${childId}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].parent_recipe_id).toBeNull()
    // SET NULL no parent_recipe_id NÃO pode disparar o trigger de origin.
    expect(rows[0].origin).toBe('ai_chat')
  })

  it('AC#4 (DB): schema_version default = SCHEMA_VERSION_RECEITA quando não especificado', async () => {
    const [row] = await sql<{ schema_version: number }[]>`
      INSERT INTO recipe (origin, original_locale)
      VALUES ('catalog', 'pt-BR')
      RETURNING schema_version
    `
    // O default do banco é fonteada pelo MESMO constante de domínio (single-source).
    expect(row.schema_version).toBe(SCHEMA_VERSION_RECEITA)
    expect(SCHEMA_VERSION_RECEITA).toBe(1)
  })

  it('AC#8: decideStale(titulo) vira stale só do pt-BR; decideStale(quantidade) é no-op', async () => {
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      provenance: 'escrita_por_pessoa',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Black Bean Stew',
      provenance: 'automatica_revisada',
    })
    await seedEmbedding({ recipeId, locale: 'pt-BR' })
    await seedEmbedding({ recipeId, locale: 'en-US' })

    // Decisão: mudar 'titulo' em pt-BR ⇒ pt-BR entra em ambas as listas.
    const decision = decideStale({ changedFields: ['titulo'], locale: 'pt-BR' })
    expect(decision).toEqual({ staleTranslations: ['pt-BR'], staleEmbeddings: ['pt-BR'] })

    for (const locale of decision.staleTranslations) {
      await db
        .update(recipeTranslation)
        .set({ stale: true })
        .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
    }
    for (const locale of decision.staleEmbeddings) {
      await db
        .update(recipeEmbedding)
        .set({ stale: true })
        .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, locale)))
    }

    const translations = await db
      .select({ locale: recipeTranslation.locale, stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, recipeId))
    const embeddings = await db
      .select({ locale: recipeEmbedding.locale, stale: recipeEmbedding.stale })
      .from(recipeEmbedding)
      .where(eq(recipeEmbedding.recipeId, recipeId))

    const byLocale = (rows: { locale: string; stale: boolean }[]) =>
      Object.fromEntries(rows.map((r) => [r.locale, r.stale]))
    expect(byLocale(translations)).toEqual({ 'pt-BR': true, 'en-US': false })
    expect(byLocale(embeddings)).toEqual({ 'pt-BR': true, 'en-US': false })

    // Decisão invariante: mudar 'quantidade' ⇒ no-op (nada vira stale).
    const noop = decideStale({ changedFields: ['quantidade'], locale: 'pt-BR' })
    expect(noop).toEqual({ staleTranslations: [], staleEmbeddings: [] })
    expect(noop.staleTranslations).toHaveLength(0)
    expect(noop.staleEmbeddings).toHaveLength(0)
  })
})

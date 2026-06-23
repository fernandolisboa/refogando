import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { asc, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipeTranslation } from '@/db/schema'
import { computeSlugBackfill, type TranslationSlugRow } from '@/domain/recipe-slug'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Slug por idioma (#229, ADR-0020) — invariantes de BANCO e o backfill, contra Postgres real
 * (roda no projeto "node" no CI). Cobre o que o teste ui PURO (test/ui/recipe-slug.test.ts)
 * não pode: a coluna nullable, o índice PARCIAL `recipe_translation_locale_slug_uq` (unicidade
 * por (locale, slug), ortogonal a (recipe_id, locale)), e o backfill ponta-a-ponta usando a
 * MESMA `computeSlugBackfill` que o script de deploy roda.
 *
 * Constraint-violations são dirigidas por um cliente RAW postgres-js — só assim o PostgresError
 * carrega `.code` no topo (modelo: recipe-constraints.test.ts).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('Slug por idioma: invariantes de banco (índice parcial recipe_translation_locale_slug_uq)', () => {
  it('coluna slug nasce NULLABLE: inserir tradução SEM slug é permitido (prod-safe)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const id = await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Sem Slug Ainda',
      provenance: 'escrita_por_pessoa',
    })
    const [row] = await sql<{ slug: string | null }[]>`
      SELECT slug FROM recipe_translation WHERE id = ${id}
    `
    expect(row.slug).toBeNull()
  })

  it('rejeita (locale, slug) DUPLICADO no mesmo locale ⇒ SQLSTATE 23505', async () => {
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const slug = `bolo-${crypto.randomUUID()}`

    await sql`
      INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance, slug)
      VALUES (${r1}, 'pt-BR', 'Bolo', 'escrita_por_pessoa', ${slug})
    `
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance, slug)
        VALUES (${r2}, 'pt-BR', 'Bolo Outro', 'escrita_por_pessoa', ${slug})
      `
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23505')
  })

  it('PERMITE o MESMO slug em locales DIFERENTES (unicidade é por (locale, slug))', async () => {
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'en-US' })
    const slug = `cake-${crypto.randomUUID()}`

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance, slug)
      VALUES (${r1}, 'pt-BR', 'Cake', 'escrita_por_pessoa', ${slug}),
             (${r2}, 'en-US', 'Cake', 'escrita_por_pessoa', ${slug})
      RETURNING id
    `
    expect(inserted).toHaveLength(2)
  })

  it('PERMITE múltiplos slug NULL no mesmo locale (índice é PARCIAL WHERE slug IS NOT NULL)', async () => {
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance, slug)
      VALUES (${r1}, 'pt-BR', 'Um', 'escrita_por_pessoa', NULL),
             (${r2}, 'pt-BR', 'Dois', 'escrita_por_pessoa', NULL)
      RETURNING id
    `
    expect(inserted).toHaveLength(2)
  })
})

describe('Slug por idioma: backfill ponta-a-ponta (computeSlugBackfill + UPDATE guardado)', () => {
  // Espelha o que scripts/backfill-recipe-slugs.ts faz: SELECT ordenado estável →
  // computeSlugBackfill → UPDATE só onde slug IS NULL. Aqui escopamos a um recipeId para não
  // colidir com outras linhas semeadas pela suíte (o índice é global por locale).
  async function runBackfillForRecipe(recipeId: string): Promise<number> {
    const db = getDb()
    const rows: TranslationSlugRow[] = await db
      .select({
        id: recipeTranslation.id,
        locale: recipeTranslation.locale,
        titulo: recipeTranslation.titulo,
        slug: recipeTranslation.slug,
      })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, recipeId))
      .orderBy(asc(recipeTranslation.locale), asc(recipeTranslation.createdAt), asc(recipeTranslation.id))
    const assignments = computeSlugBackfill(rows)
    for (const a of assignments) {
      await sql`UPDATE recipe_translation SET slug = ${a.slug} WHERE id = ${a.id} AND slug IS NULL`
    }
    return assignments.length
  }

  it('preenche traduções sem slug derivando do título, por locale, idempotente', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de Cenoura',
      provenance: 'escrita_por_pessoa',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Carrot Cake',
      provenance: 'automatica_nao_revisada',
    })

    const updated1 = await runBackfillForRecipe(recipeId)
    expect(updated1).toBe(2)

    const bySlug = async () =>
      Object.fromEntries(
        (
          await getDb()
            .select({ locale: recipeTranslation.locale, slug: recipeTranslation.slug })
            .from(recipeTranslation)
            .where(eq(recipeTranslation.recipeId, recipeId))
        ).map((r) => [r.locale, r.slug]),
      )

    expect(await bySlug()).toEqual({ 'pt-BR': 'bolo-de-cenoura', 'en-US': 'carrot-cake' })

    // Idempotência: re-rodar não atribui nada e não muda os slugs gravados.
    const updated2 = await runBackfillForRecipe(recipeId)
    expect(updated2).toBe(0)
    expect(await bySlug()).toEqual({ 'pt-BR': 'bolo-de-cenoura', 'en-US': 'carrot-cake' })
  })

  it('CONGELAMENTO: revisar o título depois do backfill NÃO muda o slug', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'en-US' })
    const trId = await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Carrot Cake', // título da MT inicial
      provenance: 'automatica_nao_revisada',
    })

    await runBackfillForRecipe(recipeId)
    const [before] = await getDb()
      .select({ slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(before.slug).toBe('carrot-cake')

    // Revisão humana muda o título exibido…
    await getDb()
      .update(recipeTranslation)
      .set({ titulo: 'Best Carrot Cake Ever' })
      .where(eq(recipeTranslation.id, trId))

    // …mas re-rodar o backfill NÃO re-deriva (slug já não-NULL) ⇒ a URL fica congelada.
    const updated = await runBackfillForRecipe(recipeId)
    expect(updated).toBe(0)
    const [after] = await getDb()
      .select({ slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(after.slug).toBe('carrot-cake')
  })

  it('desambigua colisões de título no MESMO locale com sufixo, e o resultado passa no índice único', async () => {
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    // Mesmo título → mesmo slug-base. Os dois recipes distintos compartilham o locale pt-BR.
    const titulo = `Tortinha ${crypto.randomUUID()}`
    await seedTranslation({ recipeId: r1, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: r2, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })

    // O backfill global (sobre TODAS as linhas do locale) é o que dá o `taken` cross-recipe;
    // aqui rodamos os dois recipes em sequência para reproduzir a passada única ordenada.
    const db = getDb()
    const rows: TranslationSlugRow[] = await db
      .select({
        id: recipeTranslation.id,
        locale: recipeTranslation.locale,
        titulo: recipeTranslation.titulo,
        slug: recipeTranslation.slug,
      })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.locale, 'pt-BR'))
      .orderBy(asc(recipeTranslation.createdAt), asc(recipeTranslation.id))
    const assignments = computeSlugBackfill(rows)
    for (const a of assignments) {
      await sql`UPDATE recipe_translation SET slug = ${a.slug} WHERE id = ${a.id} AND slug IS NULL`
    }

    const slugs = (
      await db
        .select({ recipeId: recipeTranslation.recipeId, slug: recipeTranslation.slug })
        .from(recipeTranslation)
        .where(eq(recipeTranslation.locale, 'pt-BR'))
    ).filter((r) => r.recipeId === r1 || r.recipeId === r2)

    // Os dois ganharam slug não-NULL e DISTINTOS (o índice único teria recusado iguais).
    expect(slugs).toHaveLength(2)
    const distinct = new Set(slugs.map((s) => s.slug))
    expect(distinct.size).toBe(2)
    for (const s of distinct) expect(s).not.toBeNull()
  })
})

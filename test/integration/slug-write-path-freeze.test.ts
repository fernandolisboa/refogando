import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { eq, isNull } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { recipeTranslation } from '@/db/schema'
import { editCatalogRecipe } from '@/server/curate/edit'
import { editOwnRecipe } from '@/server/recipe/owner-edit'
import { applyStaleDecision } from '@/server/recipe/stale'
import { slugForNewTranslation, slugsForNewTranslations } from '@/server/recipe/slug'
import { POST as reviewRoute } from '@/app/api/recipes/[id]/translations/[locale]/review/route'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * CONGELAMENTO do slug no write-path (#243, ADR-0020 decisão 4) — endurece a invariante "a URL
 * canônica NUNCA muda depois de gravada" CONTRA Postgres real (projeto "node" no CI). Dois gaps:
 *
 *  - Gap 1 (freeze sob revisão): renomear/revisar o título OU promover a procedência NÃO re-deriva
 *    o slug. Os fluxos de edição/revisão são UPDATEs que JAMAIS tocam a coluna `slug` — só o 1º
 *    insert (a borda) a materializa via `freezeSlug`. Provado no fluxo REAL (editCatalogRecipe,
 *    editOwnRecipe, o route de review/promoção de procedência, applyStaleDecision).
 *
 *  - Gap 2 (postura de corrida): o `taken` é lido fora de lock, então dois inserts concorrentes no
 *    mesmo locale com o mesmo título-base computam o mesmo slug e o 2º bate na UNIQUE(locale, slug)
 *    parcial (23505). POSTURA DEFINITIVA: aceita-falha-rollback — o slug faz parte do MESMO
 *    insert().values(), então o 23505 dá ROLLBACK do insert INTEIRO; NUNCA grava uma linha com slug
 *    NULL. O 23505 propaga (o caller/usuário re-tenta) e a desambiguação na 2ª tentativa sucede.
 *    Provado: sob conflito, NENHUMA linha com slug NULL nasce.
 *
 * Constraint-violations são dirigidas por um cliente RAW postgres-js (só assim o PostgresError
 * carrega `.code` no topo — modelo: recipe-slug.test.ts / recipe-constraints.test.ts).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Lê o slug gravado de uma tradução (helper conciso para asserir preservação). */
async function slugOf(translationId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: recipeTranslation.slug })
    .from(recipeTranslation)
    .where(eq(recipeTranslation.id, translationId))
  return row?.slug ?? null
}

function reviewPost(id: string, locale: string, headers: Headers): Promise<Response> {
  return reviewRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}/review`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ id, locale }) },
  )
}

describe('Gap 1 — CONGELAMENTO sob revisão: editar/renomear o título PRESERVA o slug', () => {
  it('editCatalogRecipe (curador): renomear o título NÃO re-deriva o slug', async () => {
    setEmbedder(new FakeEmbedder(1536)) // applyEdit re-embeda; 1536-dim casa vector(1536)
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const trId = await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de Cenoura',
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-de-cenoura', // slug JÁ congelado (a borda o materializou na criação)
    })

    const res = await editCatalogRecipe(db, {
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de Cenoura Maravilhoso', // renomeia o título exibido…
      descricao: 'Nova descrição.',
    })
    expect(res).toBe('ok')

    // …mas a URL canônica fica congelada (o UPDATE de edição não toca `slug`).
    expect(await slugOf(trId)).toBe('bolo-de-cenoura')
    // E o título exibido REALMENTE mudou (a edição surtiu efeito — não é falso-verde).
    const [tr] = await db
      .select({ titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(tr.titulo).toBe('Bolo de Cenoura Maravilhoso')
  })

  it('editOwnRecipe (dono): renomear o título NÃO re-deriva o slug', async () => {
    setEmbedder(new FakeEmbedder(1536)) // applyEdit re-embeda; 1536-dim casa vector(1536)
    const db = getDb()
    const { userId } = await seedSessionHeaders({ email: `dono-${crypto.randomUUID()}@ex.com` })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
    })
    const trId = await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pão Caseiro',
      provenance: 'escrita_por_pessoa',
      slug: 'pao-caseiro',
    })

    const res = await editOwnRecipe(db, {
      recipeId,
      viewerId: userId,
      locale: 'pt-BR',
      patch: { titulo: 'Pão Caseiro Rústico' },
    })
    expect(res.kind).toBe('ok')

    expect(await slugOf(trId)).toBe('pao-caseiro')
    const [tr] = await db
      .select({ titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(tr.titulo).toBe('Pão Caseiro Rústico')
  })

  it('promoção de procedência (review: automatica_nao_revisada → automatica_revisada) PRESERVA o slug', async () => {
    const db = getDb()
    // Receita de COMUNIDADE pública (o review só age sobre comunidade — ADR-0011).
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: null, // owner NULL = comunidade visível, passa o gate do review
      visibility: 'public',
    })
    const trId = await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Carrot Cake',
      provenance: 'automatica_nao_revisada',
      slug: 'carrot-cake',
    })

    const { headers } = await seedSessionHeaders({
      email: `cur-${crypto.randomUUID()}@ex.com`,
      role: 'curador',
    })
    const res = await reviewPost(recipeId, 'en-US', headers)
    expect(res.status).toBe(200)

    // A procedência foi promovida…
    const [tr] = await db
      .select({ provenance: recipeTranslation.provenance })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(tr.provenance).toBe('automatica_revisada')
    // …e o slug en-US (congelado da MT inicial) ficou intacto.
    expect(await slugOf(trId)).toBe('carrot-cake')
  })

  it('revalidação (applyStaleDecision marca stale) NÃO toca o slug', async () => {
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const trId = await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Risoto',
      provenance: 'escrita_por_pessoa',
      slug: 'risoto',
    })

    await applyStaleDecision(db, recipeId, {
      staleTranslations: ['pt-BR'],
      staleEmbeddings: [],
    })

    const [tr] = await db
      .select({ slug: recipeTranslation.slug, stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.id, trId))
    expect(tr.stale).toBe(true) // a revalidação surtiu efeito…
    expect(tr.slug).toBe('risoto') // …sem mexer na URL.
  })
})

describe('Gap 2 — postura de corrida: aceita-falha-rollback, NUNCA grava slug NULL', () => {
  it('insert concorrente com mesmo (locale, slug) ⇒ 23505 dá ROLLBACK do insert inteiro (nenhuma linha NULL)', async () => {
    const db = getDb()
    // Dois recipes distintos no MESMO locale com o MESMO título-base ⇒ o write-path computa o
    // MESMO slug (o `taken` foi lido antes de qualquer um gravar — exatamente a janela de corrida).
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const titulo = `Tortinha ${crypto.randomUUID()}`

    // Ambos leem o `taken` (vazio para este slug-base) ANTES de qualquer insert → mesmo slug.
    const slug1 = await slugForNewTranslation(db, { locale: 'pt-BR', title: titulo })
    const slug2 = await slugForNewTranslation(db, { locale: 'pt-BR', title: titulo })
    expect(slug1).toBe(slug2) // a corrida computou o mesmo candidato.

    // 1º insert (com slug) sucede.
    await db.insert(recipeTranslation).values({
      recipeId: r1,
      locale: 'pt-BR',
      titulo,
      provenance: 'escrita_por_pessoa',
      slug: slug1,
    })

    // 2º insert (MESMO insert().values() com slug) bate na UNIQUE(locale, slug) parcial → 23505,
    // que dá ROLLBACK do insert INTEIRO (o slug está no MESMO statement, não há linha meio-gravada).
    // Dirigido pelo cliente RAW (postgres-js): só assim o PostgresError carrega `.code` no topo (o
    // wrapper do Drizzle aninha o erro do driver). Espelha o mesmo padrão de `recipe-slug.test.ts`.
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe_translation (recipe_id, locale, titulo, provenance, slug)
        VALUES (${r2}, 'pt-BR', ${titulo}, 'escrita_por_pessoa', ${slug2})
      `
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(PostgresError)
    expect((err as PostgresError).code).toBe('23505')

    // INVARIANTE CENTRAL: o write-path NUNCA criou uma linha com slug NULL sob conflito.
    // r2 não tem NENHUMA linha de tradução (o insert inteiro rolou para trás).
    const r2Rows = await db
      .select({ id: recipeTranslation.id, slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, r2))
    expect(r2Rows).toHaveLength(0)

    // E, globalmente, ZERO linhas com slug NULL foram criadas por este fluxo de corrida.
    const nullRows = await db
      .select({ id: recipeTranslation.id })
      .from(recipeTranslation)
      .where(isNull(recipeTranslation.slug))
    expect(nullRows).toHaveLength(0)
  })

  it('re-tentativa após o 23505 SUCEDE: re-ler o `taken` desambigua e o 2º slug fica distinto', async () => {
    const db = getDb()
    const r1 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const r2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const titulo = `Empadinha ${crypto.randomUUID()}`

    // 1º grava o slug-base.
    const slug1 = await slugForNewTranslation(db, { locale: 'pt-BR', title: titulo })
    await db.insert(recipeTranslation).values({
      recipeId: r1,
      locale: 'pt-BR',
      titulo,
      provenance: 'escrita_por_pessoa',
      slug: slug1,
    })

    // A postura "aceita-falha-rollback" delega ao caller re-tentar. Re-tentar = re-ler o `taken`
    // (agora COM slug1) e recomputar → desambiguação determinística (slug-base + '-1').
    const slug2 = await slugForNewTranslation(db, { locale: 'pt-BR', title: titulo })
    expect(slug2).not.toBe(slug1)
    await db.insert(recipeTranslation).values({
      recipeId: r2,
      locale: 'pt-BR',
      titulo,
      provenance: 'escrita_por_pessoa',
      slug: slug2,
    })

    const rows = await db
      .select({ recipeId: recipeTranslation.recipeId, slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.locale, 'pt-BR'))
    const mine = rows.filter((r) => r.recipeId === r1 || r.recipeId === r2)
    expect(mine).toHaveLength(2)
    for (const m of mine) expect(m.slug).not.toBeNull()
    expect(new Set(mine.map((m) => m.slug)).size).toBe(2) // distintos
  })

  it('slugsForNewTranslations (lote) já desambigua as IRMÃS do mesmo lote ⇒ nenhum slug NULL, todos distintos', async () => {
    const db = getDb()
    // Duas traduções nascentes no MESMO locale com o MESMO título no MESMO lote (caso de derive):
    // o helper desambigua localmente — nunca emite dois slugs iguais que bateriam na UNIQUE.
    const titulo = `Coxinha ${crypto.randomUUID()}`
    const slugs = await slugsForNewTranslations(db, [
      { locale: 'pt-BR', title: titulo },
      { locale: 'pt-BR', title: titulo },
    ])
    expect(slugs).toHaveLength(2)
    for (const s of slugs) expect(s.length).toBeGreaterThan(0)
    expect(new Set(slugs).size).toBe(2) // irmãs do lote já saem distintas
  })
})

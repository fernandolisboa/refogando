import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { POST as reviewRoute } from '@/app/api/recipes/[id]/translations/[locale]/review/route'
import { GET as staleListRoute } from '@/app/api/curate/translations/stale/route'
import { recipe, recipeTranslation } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Curadoria de tradução pela porta MAIS ALTA (issue #23): C5 review (AC2.1, flip
 * automatica_nao_revisada→automatica_revisada SÓ comunidade) + C6 stale-list (AC2.2, só
 * comunidade). MUST-FIX de escopo ADR-0011: curador NUNCA toca/lista conteúdo PRIVADO de
 * usuário (isso é #18). Espelha auth-gating.test.ts (degraus de papel) + recipes-publish.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function review(id: string, locale: string, headers?: Headers): Promise<Response> {
  return reviewRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}/review`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ id, locale }) },
  )
}

function staleList(headers?: Headers): Promise<Response> {
  return staleListRoute(
    new Request('http://localhost/api/curate/translations/stale', { headers }),
  )
}

async function readProvenance(id: string, locale: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ provenance: recipeTranslation.provenance })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, locale)))
  return row?.provenance
}

async function readUpdatedAt(id: string, locale: string): Promise<Date | undefined> {
  const [row] = await getDb()
    .select({ updatedAt: recipeTranslation.updatedAt })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, locale)))
  return row?.updatedAt
}

/**
 * Remove a Receita do pool pela MODERAÇÃO (#18): seta as 3 colunas juntas (a CHECK
 * `recipe_moderation_consistency_chk` exige removedAt e moderatedBy ambos não-nulos).
 * NÃO toca `visibility` (≠ despublicar, AC3) — espelha `applyModerationRemove`.
 */
async function moderationRemove(recipeId: string, curatorId: string): Promise<void> {
  await getDb()
    .update(recipe)
    .set({ moderationRemovedAt: new Date(), moderationReason: 'spam', moderatedBy: curatorId })
    .where(eq(recipe.id, recipeId))
}

/** Receita de comunidade pública com en-US sinalizada (não revisada). */
async function seedCommunityUnreviewed(ownerId: string | null): Promise<string> {
  const id = await seedRecipe({
    origin: ownerId ? 'ai_chat' : 'catalog',
    originalLocale: 'pt-BR',
    visibility: ownerId ? 'public' : 'private',
    ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
  await seedTranslation({
    recipeId: id,
    locale: 'en-US',
    titulo: 'Cake',
    provenance: 'automatica_nao_revisada',
  })
  return id
}

describe('POST review #23 — AC2.1 (curador remove sinalização, só comunidade)', () => {
  it('pública (dono) ⇒ flip automatica_nao_revisada→automatica_revisada + bump updatedAt', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-pub-rev@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-pub@ex.com', role: 'curador' })
    const id = await seedCommunityUnreviewed(ownerId)

    // Semeia a linha en-US com um updatedAt explicitamente ANTIGO, eliminando flutter de
    // clock-skew (DB now() do seed vs Node new Date() do review). O review DEVE avançá-lo.
    const old = new Date('2020-01-01T00:00:00.000Z')
    await getDb()
      .update(recipeTranslation)
      .set({ updatedAt: old })
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
    const before = await readUpdatedAt(id, 'en-US')
    expect(before?.getTime()).toBe(old.getTime())

    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(await readProvenance(id, 'en-US')).toBe('automatica_revisada')

    // O review bump `updatedAt` (sem $onUpdate no Drizzle): comparar contra o valor
    // pré-capturado (estritamente >), nunca contra now() — evita flutter de mesmo-instante.
    const after = await readUpdatedAt(id, 'en-US')
    expect(after).toBeInstanceOf(Date)
    expect(after!.getTime()).toBeGreaterThan(before!.getTime())
  })

  it('catálogo (owner NULL) ⇒ flip', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-cat@ex.com', role: 'curador' })
    const id = await seedCommunityUnreviewed(null)
    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(200)
    expect(await readProvenance(id, 'en-US')).toBe('automatica_revisada')
  })

  it('MUST-FIX: PRIVADA de usuário ⇒ 404 no-op (proveniência intacta)', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-priv-rev@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-priv@ex.com', role: 'curador' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedTranslation({
      recipeId: id,
      locale: 'en-US',
      titulo: 'Cake',
      provenance: 'automatica_nao_revisada',
    })

    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(404)
    expect(await readProvenance(id, 'en-US')).toBe('automatica_nao_revisada') // intacta
  })

  it('#18: pública REMOVIDA do pool pela moderação ⇒ 404 no-op (proveniência intacta)', async () => {
    // Receita pública (estaria na comunidade), mas o Curador a removeu do pool: o gate de
    // comunidade ganha `moderation_removed_at IS NULL`, então o review é 404 leak-safe (não
    // des-sinaliza tradução de Receita já moderada). visibility segue 'public' (AC3).
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-mod-rev@ex.com' })
    const { userId: curatorId, headers } = await seedSessionHeaders({
      email: 'curador-mod-rev@ex.com',
      role: 'curador',
    })
    const id = await seedCommunityUnreviewed(ownerId)
    await moderationRemove(id, curatorId)

    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(404)
    expect(await readProvenance(id, 'en-US')).toBe('automatica_nao_revisada') // intacta
  })

  it('usuario ⇒ 403', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-403@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'user-403@ex.com', role: 'usuario' })
    const id = await seedCommunityUnreviewed(ownerId)
    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(403)
  })

  it('anônimo ⇒ 401', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-401@ex.com' })
    const id = await seedCommunityUnreviewed(ownerId)
    const res = await review(id, 'en-US') // sem headers
    expect(res.status).toBe(401)
  })

  it('idempotente: já-revisada (pública) ⇒ 200 no-op', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-idem-rev@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-idem@ex.com', role: 'curador' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedTranslation({
      recipeId: id,
      locale: 'en-US',
      titulo: 'Cake',
      provenance: 'automatica_revisada',
    })
    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(200)
    expect(await readProvenance(id, 'en-US')).toBe('automatica_revisada') // não rebaixa
  })

  it('NÃO rebaixa escrita_por_pessoa (WHERE protege)', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-pessoa@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-pessoa@ex.com', role: 'curador' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: 'Cake', provenance: 'escrita_por_pessoa' })
    const res = await review(id, 'en-US', headers)
    expect(res.status).toBe(200)
    expect(await readProvenance(id, 'en-US')).toBe('escrita_por_pessoa') // intacta
  })

  it('linha de tradução inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-noline@ex.com', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    const res = await review(id, 'en-US', headers) // sem linha en-US
    expect(res.status).toBe(404)
  })

  it('id malformado ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-badid@ex.com', role: 'curador' })
    const res = await review('not-a-uuid', 'en-US', headers)
    expect(res.status).toBe(404)
  })
})

describe('GET stale-list #23 — AC2.2 (só comunidade)', () => {
  it('curador ⇒ só stale=true de pública/catálogo; PRIVADA EXCLUÍDA', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-list@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-list@ex.com', role: 'curador' })

    // Pública stale (deve aparecer).
    const pub = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: pub, locale: 'pt-BR', titulo: 'P', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: pub, locale: 'en-US', titulo: 'P-en', provenance: 'automatica_revisada', stale: true })

    // Catálogo stale (deve aparecer).
    const cat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: cat, locale: 'pt-BR', titulo: 'C', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: cat, locale: 'en-US', titulo: 'C-en', provenance: 'automatica_revisada', stale: true })

    // Privada stale (NÃO deve aparecer — MUST-FIX).
    const priv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'V', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: priv, locale: 'en-US', titulo: 'V-en', provenance: 'automatica_revisada', stale: true })

    // Pública NÃO-stale (controle: não aparece).
    const fresh = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: fresh, locale: 'pt-BR', titulo: 'F', provenance: 'escrita_por_pessoa' })

    const res = await staleList(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      stale: { recipeId: string; locale: string; provenance: string }[]
    }
    const ids = body.stale.map((r) => r.recipeId)
    expect(ids).toContain(pub)
    expect(ids).toContain(cat)
    expect(ids).not.toContain(priv) // PRIVADA excluída
    expect(ids).not.toContain(fresh) // não-stale excluída

    // Shape COMPLETO (locale + provenance projetados) das entradas pública e de catálogo.
    // Ambas foram semeadas en-US/automatica_revisada/stale=true — a projeção DEVE trazê-lo.
    const pubEntry = body.stale.find((r) => r.recipeId === pub)
    expect(pubEntry).toEqual({ recipeId: pub, locale: 'en-US', provenance: 'automatica_revisada' })
    const catEntry = body.stale.find((r) => r.recipeId === cat)
    expect(catEntry).toEqual({ recipeId: cat, locale: 'en-US', provenance: 'automatica_revisada' })
  })

  it('#18: pública stale mas REMOVIDA do pool pela moderação ⇒ EXCLUÍDA da fila', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-mod-list@ex.com' })
    const { userId: curatorId, headers } = await seedSessionHeaders({
      email: 'curador-mod-list@ex.com',
      role: 'curador',
    })

    // Pública stale, ainda no pool (deve aparecer — controle).
    const pub = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: pub, locale: 'pt-BR', titulo: 'P', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: pub, locale: 'en-US', titulo: 'P-en', provenance: 'automatica_revisada', stale: true })

    // Pública stale, REMOVIDA do pool pela moderação (NÃO deve aparecer — #18).
    const removed = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: removed, locale: 'pt-BR', titulo: 'R', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: removed, locale: 'en-US', titulo: 'R-en', provenance: 'automatica_revisada', stale: true })
    await moderationRemove(removed, curatorId)

    const res = await staleList(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stale: { recipeId: string }[] }
    const ids = body.stale.map((r) => r.recipeId)
    expect(ids).toContain(pub) // ainda no pool
    expect(ids).not.toContain(removed) // removida do pool pela moderação
  })

  it('usuario ⇒ 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user-list-403@ex.com', role: 'usuario' })
    const res = await staleList(headers)
    expect(res.status).toBe(403)
  })

  it('anônimo ⇒ 401', async () => {
    const res = await staleList() // sem headers
    expect(res.status).toBe(401)
  })

  it('lista vazia ⇒ 200 + []', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-empty@ex.com', role: 'curador' })
    const res = await staleList(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ stale: [] })
  })
})

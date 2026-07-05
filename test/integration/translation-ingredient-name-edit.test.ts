import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { PATCH as patchRoute } from '@/app/api/recipes/[id]/translations/[locale]/route'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'

/**
 * PATCH /api/recipes/[id]/translations/[locale] — Curador edita o NOME de ingrediente
 * traduzido na fila (#498, ADR-0031 companheiro (iii)). Pela porta MAIS ALTA (route handler
 * real). Mesma família de gate de `curator-translation.test.ts` (review/route.ts):
 * `requireRole('curador')` + comunidade (pública OU owner-null) + `moderation_removed_at
 * IS NULL`, 404 leak-safe para privado/removido.
 */

function withJson(base?: Headers): Headers {
  const h = base ? new Headers(base) : new Headers()
  h.set('content-type', 'application/json')
  return h
}

function patch(id: string, locale: string, body: unknown, headers?: Headers): Promise<Response> {
  return patchRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}`, {
      method: 'PATCH',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id, locale }) },
  )
}

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function readIngredientes(
  id: string,
  locale: string,
): Promise<{ ordem: number; nome: string; nomeOrigem: string }[] | null> {
  const [row] = await getDb()
    .select({ ingredientes: recipeTranslation.ingredientes })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, locale)))
  return row?.ingredientes ?? null
}

async function moderationRemove(recipeId: string, curatorId: string): Promise<void> {
  await getDb()
    .update(recipe)
    .set({ moderationRemovedAt: new Date(), moderationReason: 'spam', moderatedBy: curatorId })
    .where(eq(recipe.id, recipeId))
}

/** Receita de comunidade (pública ou catálogo owner-null) com en-US já traduzida (jsonb prévio). */
async function seedCommunityWithIngredientes(input: {
  ownerId: string | null
  ingredientes?: { ordem: number; nome: string; nomeOrigem: string }[] | null
}): Promise<string> {
  const id = await seedRecipe({
    origin: input.ownerId ? 'ai_chat' : 'catalog',
    originalLocale: 'pt-BR',
    visibility: input.ownerId ? 'public' : 'private',
    ownerId: input.ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
  await seedTranslation({
    recipeId: id,
    locale: 'en-US',
    titulo: 'Black Bean Stew',
    provenance: 'automatica_nao_revisada',
  })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, quantidade: '3', unidade: 'dente', rawText: 'alho' })
  await seedRecipeIngredient({ recipeId: id, ordem: 1, quantidade: '500', unidade: 'g', rawText: 'feijão-preto' })
  if (input.ingredientes !== undefined) {
    await getDb()
      .update(recipeTranslation)
      .set({ ingredientes: input.ingredientes })
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
  }
  return id
}

describe('PATCH translations/[locale] #498 — Curador edita nome de ingrediente traduzido', () => {
  it('pública (dono) ⇒ 200, grava nome editado + nomeOrigem=raw_text ATUAL; MEDIDA/raw_text intocados', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-ing-pub@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-pub@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({
      ownerId,
      ingredientes: [
        { ordem: 0, nome: 'garlic', nomeOrigem: 'alho' },
        { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' },
      ],
    })

    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'fresh garlic' }] }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const ingredientes = await readIngredientes(id, 'en-US')
    expect(ingredientes).toEqual([
      { ordem: 0, nome: 'fresh garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' }, // não-editado, intocado
    ])

    // raw_text em recipe_ingredient permanece intacto (não re-escrito) — o nome editado vive SÓ no
    // jsonb da tradução, nunca na fonte monolíngue.
    const ingredientRows = await getDb()
      .select({ ordem: recipeIngredient.ordem, rawText: recipeIngredient.rawText })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, id))
      .orderBy(recipeIngredient.ordem)
    expect(ingredientRows).toEqual([
      { ordem: 0, rawText: 'alho' },
      { ordem: 1, rawText: 'feijão-preto' },
    ])
  })

  it('catálogo (owner NULL) ⇒ 200, grava a edição', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-cat@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({ ownerId: null, ingredientes: null })

    const res = await patch(id, 'en-US', { edits: [{ ordem: 1, nome: 'black beans' }] }, headers)
    expect(res.status).toBe(200)
    const ingredientes = await readIngredientes(id, 'en-US')
    expect(ingredientes).toEqual([{ ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' }])
  })

  it('LOAD-BEARING: nomeOrigem grava o raw_text ATUAL mesmo quando a entrada antiga já divergia (rename prévio sem re-tradução)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-drift@ex.com', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    await seedTranslation({
      recipeId: id,
      locale: 'en-US',
      titulo: 'Black Bean Stew',
      provenance: 'automatica_nao_revisada',
    })
    // raw_text JÁ mudou para 'alho roxo' desde a tradução original ('alho') — a entrada
    // antiga já estava divergente (nomeOrigem !== raw_text atual ⇒ display cairia no raw_text).
    await seedRecipeIngredient({ recipeId: id, ordem: 0, quantidade: '3', unidade: 'dente', rawText: 'alho roxo' })
    await getDb()
      .update(recipeTranslation)
      .set({ ingredientes: [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }] })
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))

    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'purple garlic' }] }, headers)
    expect(res.status).toBe(200)
    const ingredientes = await readIngredientes(id, 'en-US')
    // nomeOrigem religado ao raw_text ATUAL ('alho roxo') — o nome editado passa a ser exibido.
    expect(ingredientes).toEqual([{ ordem: 0, nome: 'purple garlic', nomeOrigem: 'alho roxo' }])
  })

  it('MUST-FIX: PRIVADA de usuário ⇒ 404 no-op (jsonb intacto)', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-ing-priv@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-priv@ex.com', role: 'curador' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: 'Cake', provenance: 'automatica_nao_revisada' })
    await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'farinha' })
    await getDb()
      .update(recipeTranslation)
      .set({ ingredientes: [{ ordem: 0, nome: 'flour', nomeOrigem: 'farinha' }] })
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))

    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'wheat flour' }] }, headers)
    expect(res.status).toBe(404)
    expect(await readIngredientes(id, 'en-US')).toEqual([{ ordem: 0, nome: 'flour', nomeOrigem: 'farinha' }])
  })

  it('#18: pública REMOVIDA do pool pela moderação ⇒ 404 no-op', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-ing-mod@ex.com' })
    const { userId: curatorId, headers } = await seedSessionHeaders({
      email: 'curador-ing-mod@ex.com',
      role: 'curador',
    })
    const id = await seedCommunityWithIngredientes({
      ownerId,
      ingredientes: [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }],
    })
    await moderationRemove(id, curatorId)

    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'fresh garlic' }] }, headers)
    expect(res.status).toBe(404)
    expect(await readIngredientes(id, 'en-US')).toEqual([{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }])
  })

  it('usuario ⇒ 403', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-ing-403@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'user-ing-403@ex.com', role: 'usuario' })
    const id = await seedCommunityWithIngredientes({ ownerId })
    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'fresh garlic' }] }, headers)
    expect(res.status).toBe(403)
  })

  it('anônimo ⇒ 401', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-ing-401@ex.com' })
    const id = await seedCommunityWithIngredientes({ ownerId })
    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'fresh garlic' }] })
    expect(res.status).toBe(401)
  })

  it('linha de tradução inexistente (locale sem tradução) ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-noline@ex.com', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'farinha' })
    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: 'flour' }] }, headers) // sem linha en-US
    expect(res.status).toBe(404)
  })

  it('ordem inexistente/sem raw_text ⇒ 400 dados_invalidos, jsonb intacto', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-badordem@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({
      ownerId: null,
      ingredientes: [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }],
    })
    const res = await patch(id, 'en-US', { edits: [{ ordem: 99, nome: 'x' }] }, headers)
    expect(res.status).toBe(400)
    expect(await readIngredientes(id, 'en-US')).toEqual([{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }])
  })

  it('nome vazio/em-branco ⇒ 400 dados_invalidos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-blank@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({ ownerId: null, ingredientes: null })
    const res = await patch(id, 'en-US', { edits: [{ ordem: 0, nome: '   ' }] }, headers)
    expect(res.status).toBe(400)
  })

  it('body malformado (edits ausente/não-array) ⇒ 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-malformed@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({ ownerId: null, ingredientes: null })
    const res = await patch(id, 'en-US', { edits: 'not-an-array' }, headers)
    expect(res.status).toBe(400)
  })

  it('id malformado ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-badid@ex.com', role: 'curador' })
    const res = await patch('not-a-uuid', 'en-US', { edits: [] }, headers)
    expect(res.status).toBe(404)
  })

  it('locale não suportado ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-badlocale@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({ ownerId: null, ingredientes: null })
    const res = await patch(id, 'fr-FR', { edits: [] }, headers)
    expect(res.status).toBe(404)
  })

  it('edits vazio ⇒ 200 no-op idempotente (jsonb inalterado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-ing-noop@ex.com', role: 'curador' })
    const id = await seedCommunityWithIngredientes({
      ownerId: null,
      ingredientes: [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }],
    })
    const res = await patch(id, 'en-US', { edits: [] }, headers)
    expect(res.status).toBe(200)
    expect(await readIngredientes(id, 'en-US')).toEqual([{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }])
  })
})

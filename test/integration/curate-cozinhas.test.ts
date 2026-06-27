import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { GET } from '@/app/api/curate/cozinhas/route'
import { POST as APPROVE } from '@/app/api/curate/cozinhas/[slug]/approve/route'
import { POST as MERGE } from '@/app/api/curate/cozinhas/[slug]/merge/route'
import { POST as REJECT } from '@/app/api/curate/cozinhas/[slug]/reject/route'
import { __clearVocabularyCache, loadVocabulary } from '@/server/vocabulary/load'
import { suggestCozinha } from '@/server/vocabulary/suggest'
import { getDb } from '@/server/deps'
import { vocabularyTerm, recipe, briefing } from '@/db/schema'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'
import { seedBriefing } from '../helpers/generation'

/**
 * Fila do Curador para `cozinha` (#320, ADR-0025 Decisão 5: curadoria REATIVA). Contra Postgres real
 * + sessões reais. Prova: LIST só `suggested` com recipeCount (multi-owner, count(recipe.id) não
 * count(*)); APPROVE (rótulos obrigatórios; em-place vs correção-de-slug; tombstone; FK válida);
 * MERGE (alvo ativo; reaponta recipe; briefing imutável); REJECT (anula recipe.cozinha; briefing
 * imutável); TOMBSTONE nunca deletado + reuso por suggestCozinha; anti-corrida; gating por papel.
 *
 * SEED FK-CRÍTICO: insere a linha `vocabulary_term` 'suggested' ANTES de qualquer recipe/briefing
 * que aponte o slug — senão o próprio seed estoura 23503 (recipe.cozinha é FK ON DELETE RESTRICT).
 *
 * CACHE: as rotas NÃO bustam o TTL de 30s de loadVocabulary; limpamos o Map à mão (truncate global
 * apaga LINHAS, não o Map). `test/setup.ts` reseed as 15 cozinhas ativas num beforeEach global.
 */

beforeEach(() => __clearVocabularyCache())
afterEach(() => __clearVocabularyCache())

// ── helpers de request ─────────────────────────────────────────────────────────
function getQueue(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/curate/cozinhas', { headers }))
}
function approve(slug: string, body: unknown, headers?: Headers): Promise<Response> {
  return APPROVE(
    new Request(`http://localhost/api/curate/cozinhas/${encodeURIComponent(slug)}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: encodeURIComponent(slug) }) },
  )
}
function merge(slug: string, body: unknown, headers?: Headers): Promise<Response> {
  return MERGE(
    new Request(`http://localhost/api/curate/cozinhas/${encodeURIComponent(slug)}/merge`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: encodeURIComponent(slug) }) },
  )
}
function reject(slug: string, headers?: Headers): Promise<Response> {
  return REJECT(
    new Request(`http://localhost/api/curate/cozinhas/${encodeURIComponent(slug)}/reject`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ slug: encodeURIComponent(slug) }) },
  )
}

async function curadorHeaders(email: string): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email, role: 'curador' })
  return headers
}

/** Insere uma linha de termo de cozinha em status arbitrário (sem passar por suggest.ts). */
async function insertTerm(slug: string, status: 'suggested' | 'merged' | 'rejected'): Promise<void> {
  await getDb().insert(vocabularyTerm).values({ kind: 'cozinha', slug, status })
}

async function statusOf(slug: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: vocabularyTerm.status })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
  return row?.status
}

async function countTerms(): Promise<number> {
  const rows = await getDb().select({ slug: vocabularyTerm.slug }).from(vocabularyTerm)
  return rows.length
}

// ── LIST ─────────────────────────────────────────────────────────────────────
describe('GET /api/curate/cozinhas — lista só suggested com recipeCount', () => {
  it('lista apenas status=suggested; recipeCount é multi-owner; zero-receita → 0', async () => {
    const headers = await curadorHeaders('list@cur.test')

    // 'georgiana' (suggested) com 2 receitas de 2 DONOS diferentes → recipeCount 2.
    await insertTerm('georgiana', 'suggested')
    const o1 = await seedUser({ email: 'o1@cur.test' })
    const o2 = await seedUser({ email: 'o2@cur.test' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o2, cozinha: 'georgiana' })

    // 'etiope' (suggested) SEM receita → recipeCount 0 (trava count(recipe.id), não count(*)).
    await insertTerm('etiope', 'suggested')
    // lápides e ativas NÃO aparecem na fila.
    await insertTerm('fundida', 'merged')
    await insertTerm('recusada', 'rejected')

    const res = await getQueue(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cozinhas: Array<{ slug: string; recipeCount: number }> }

    const slugs = body.cozinhas.map((c) => c.slug)
    expect(slugs).toEqual(expect.arrayContaining(['georgiana', 'etiope']))
    expect(slugs).not.toContain('fundida')
    expect(slugs).not.toContain('recusada')
    expect(slugs).not.toContain('italiana') // active não entra
    expect(body.cozinhas.find((c) => c.slug === 'georgiana')?.recipeCount).toBe(2)
    expect(body.cozinhas.find((c) => c.slug === 'etiope')?.recipeCount).toBe(0)
  })
})

// ── APPROVE ──────────────────────────────────────────────────────────────────
describe('POST .../approve — aprova sugerida', () => {
  it('rótulo em branco/faltante → 400 rotulos_invalidos; permanece suggested', async () => {
    const headers = await curadorHeaders('appbad@cur.test')
    await insertTerm('georgiana', 'suggested')

    const r1 = await approve('georgiana', { labelPtBr: '  ', labelEnUs: 'Georgian' }, headers)
    expect(r1.status).toBe(400)
    await expect(r1.json()).resolves.toMatchObject({ error: 'rotulos_invalidos' })

    const r2 = await approve('georgiana', { labelPtBr: 'Georgiana' }, headers)
    expect(r2.status).toBe(400)
    await expect(r2.json()).resolves.toMatchObject({ error: 'rotulos_invalidos' })

    expect(await statusOf('georgiana')).toBe('suggested')
  })

  it('sem correção de slug → suggested→active, sort=max+1, ponteiros inalterados, vira faceta active', async () => {
    const headers = await curadorHeaders('appok@cur.test')
    await insertTerm('georgiana', 'suggested')
    const owner = await seedUser({ email: 'appok-o@cur.test' })
    const rid = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: owner,
      cozinha: 'georgiana',
    })
    const bid = await seedBriefing({ cozinha: 'georgiana' })

    const res = await approve('georgiana', { labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, slug: 'georgiana' })

    expect(await statusOf('georgiana')).toBe('active')
    // sort = max(cozinha.sort)+1. As 15 baseline têm sort 0..14 → novo = 15.
    const [term] = await getDb()
      .select({ sort: vocabularyTerm.sort, labelPtBr: vocabularyTerm.labelPtBr })
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.slug, 'georgiana'))
    expect(term.sort).toBe(15)
    expect(term.labelPtBr).toBe('Georgiana')

    // Ponteiros NÃO mudam (sem correção de slug).
    const [rrow] = await getDb().select({ cozinha: recipe.cozinha }).from(recipe).where(eq(recipe.id, rid))
    const [brow] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing).where(eq(briefing.id, bid))
    expect(rrow.cozinha).toBe('georgiana')
    expect(brow.cozinha).toBe('georgiana')

    __clearVocabularyCache()
    const active = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(active.map((r) => r.slug)).toContain('georgiana')
  })

  it('com correção de slug → cria novo active, reaponta recipe E briefing de TODOS, tomba o antigo (merged)', async () => {
    const headers = await curadorHeaders('apprename@cur.test')
    await insertTerm('georgianna', 'suggested') // typo
    const o1 = await seedUser({ email: 'rn-o1@cur.test' })
    const o2 = await seedUser({ email: 'rn-o2@cur.test' })
    const r1 = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgianna' })
    const r2 = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o2, cozinha: 'georgianna' })
    const bid = await seedBriefing({ cozinha: 'georgianna' })

    const before = await countTerms()
    const res = await approve(
      'georgianna',
      { labelPtBr: 'Georgiana', labelEnUs: 'Georgian', newSlug: 'georgiana' },
      headers,
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, slug: 'georgiana' })

    expect(await statusOf('georgiana')).toBe('active')
    expect(await statusOf('georgianna')).toBe('merged') // tombstone, não deletado
    expect(await countTerms()).toBe(before + 1) // só ganhou a nova linha; antiga persiste

    for (const id of [r1, r2]) {
      const [rrow] = await getDb().select({ cozinha: recipe.cozinha }).from(recipe).where(eq(recipe.id, id))
      expect(rrow.cozinha).toBe('georgiana') // ambos os donos repontados
    }
    const [brow] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing).where(eq(briefing.id, bid))
    expect(brow.cozinha).toBe('georgiana') // briefing repontado (correção de slug canônico)
  })

  it('newSlug colidindo com slug existente (incl. lápide) → 409 slug_em_uso', async () => {
    const headers = await curadorHeaders('appcol@cur.test')
    await insertTerm('georgianna', 'suggested')
    await insertTerm('antiga-tomb', 'merged') // lápide pré-existente

    // colide com active
    const rActive = await approve(
      'georgianna',
      { labelPtBr: 'X', labelEnUs: 'X', newSlug: 'italiana' },
      headers,
    )
    expect(rActive.status).toBe(409)
    await expect(rActive.json()).resolves.toMatchObject({ error: 'slug_em_uso' })

    // colide com lápide
    const rTomb = await approve(
      'georgianna',
      { labelPtBr: 'X', labelEnUs: 'X', newSlug: 'antiga-tomb' },
      headers,
    )
    expect(rTomb.status).toBe(409)
    await expect(rTomb.json()).resolves.toMatchObject({ error: 'slug_em_uso' })

    expect(await statusOf('georgianna')).toBe('suggested') // não resolvida
  })

  it('newSlug malformado → 400 slug_invalido', async () => {
    const headers = await curadorHeaders('appmal@cur.test')
    await insertTerm('georgianna', 'suggested')
    const res = await approve(
      'georgianna',
      { labelPtBr: 'X', labelEnUs: 'X', newSlug: 'Não Slug!' },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'slug_invalido' })
    expect(await statusOf('georgianna')).toBe('suggested')
  })
})

// ── MERGE ────────────────────────────────────────────────────────────────────
describe('POST .../merge — mescla numa ativa', () => {
  it('alvo não-ativo → 400 alvo_invalido', async () => {
    const headers = await curadorHeaders('mgbad@cur.test')
    await insertTerm('georgiana', 'suggested')
    await insertTerm('outra-sug', 'suggested')

    expect((await merge('georgiana', { target: 'nao-existe' }, headers)).status).toBe(400)
    const res = await merge('georgiana', { target: 'outra-sug' }, headers) // alvo suggested, não active
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'alvo_invalido' })
    expect(await statusOf('georgiana')).toBe('suggested')
  })

  it('reaponta recipe (todos os donos) → alvo; tomba suggested (merged); briefing NÃO reescrito', async () => {
    const headers = await curadorHeaders('mgok@cur.test')
    await insertTerm('georgiana', 'suggested')
    const o1 = await seedUser({ email: 'mg-o1@cur.test' })
    const o2 = await seedUser({ email: 'mg-o2@cur.test' })
    const r1 = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: o1,
      cozinha: 'georgiana',
    })
    const r2 = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: o2,
      cozinha: 'georgiana',
    })
    const bid = await seedBriefing({ cozinha: 'georgiana' })

    const before = await countTerms()
    const res = await merge('georgiana', { target: 'italiana' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    expect(await statusOf('georgiana')).toBe('merged')
    expect(await countTerms()).toBe(before) // nada deletado

    for (const id of [r1, r2]) {
      const [rrow] = await getDb()
        .select({ cozinha: recipe.cozinha, visibility: recipe.visibility })
        .from(recipe)
        .where(eq(recipe.id, id))
      expect(rrow.cozinha).toBe('italiana') // repontada
      expect(rrow.visibility).toBe('public') // visibility intocada
    }
    // briefing NÃO reescrito: segue apontando a lápide 'georgiana' (FK válida — linha persiste).
    const [brow] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing).where(eq(briefing.id, bid))
    expect(brow.cozinha).toBe('georgiana')
  })
})

// ── REJECT ───────────────────────────────────────────────────────────────────
describe('POST .../reject — rejeita sugerida', () => {
  it('anula recipe.cozinha (todos os donos); tomba (rejected); briefing NÃO reescrito; receita segue pública', async () => {
    const headers = await curadorHeaders('rjok@cur.test')
    await insertTerm('georgiana', 'suggested')
    const o1 = await seedUser({ email: 'rj-o1@cur.test' })
    const o2 = await seedUser({ email: 'rj-o2@cur.test' })
    const r1 = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: o1,
      cozinha: 'georgiana',
    })
    const r2 = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: o2,
      cozinha: 'georgiana',
    })
    const bid = await seedBriefing({ cozinha: 'georgiana' })

    const before = await countTerms()
    const res = await reject('georgiana', headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    expect(await statusOf('georgiana')).toBe('rejected')
    expect(await countTerms()).toBe(before)

    for (const id of [r1, r2]) {
      const [rrow] = await getDb()
        .select({ cozinha: recipe.cozinha, visibility: recipe.visibility })
        .from(recipe)
        .where(eq(recipe.id, id))
      expect(rrow.cozinha).toBeNull() // anulada
      expect(rrow.visibility).toBe('public') // publicada segue publicada
    }
    const [brow] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing).where(eq(briefing.id, bid))
    expect(brow.cozinha).toBe('georgiana') // briefing imutável (FK válida, lápide persiste)
  })
})

// ── TOMBSTONE + reuso ────────────────────────────────────────────────────────
describe('tombstone nunca deletado + reuso por suggestCozinha', () => {
  it('suggestCozinha de um slug mergeado/rejeitado REUSA a lápide (não insere)', async () => {
    await curadorHeaders('tomb@cur.test')
    await insertTerm('georgiana', 'merged')
    await insertTerm('etiope', 'rejected')

    const before = await countTerms()
    expect(await suggestCozinha(getDb(), 'georgiana')).toBe('georgiana')
    expect(await suggestCozinha(getDb(), 'etiope')).toBe('etiope')
    expect(await countTerms()).toBe(before) // nada inserido; lápides reusadas
    expect(await statusOf('georgiana')).toBe('merged') // status preservado
    expect(await statusOf('etiope')).toBe('rejected')
  })
})

// ── ANTI-CORRIDA ─────────────────────────────────────────────────────────────
describe('anti-corrida + slug inexistente', () => {
  it('ação sobre slug não-suggested → 409 ja_resolvido; slug desconhecido → 404 nao_encontrado', async () => {
    const headers = await curadorHeaders('race@cur.test')
    await insertTerm('fundida', 'merged')

    // já resolvida (merged) → 409 em todas as ações.
    expect((await approve('fundida', { labelPtBr: 'X', labelEnUs: 'X' }, headers)).status).toBe(409)
    expect((await merge('fundida', { target: 'italiana' }, headers)).status).toBe(409)
    const rr = await reject('fundida', headers)
    expect(rr.status).toBe(409)
    await expect(rr.json()).resolves.toMatchObject({ error: 'ja_resolvido' })

    // active (ciclo do Admin) também não é resolúvel por aqui.
    expect((await approve('italiana', { labelPtBr: 'X', labelEnUs: 'X' }, headers)).status).toBe(409)

    // slug desconhecido → 404.
    const r404 = await approve('inexistente', { labelPtBr: 'X', labelEnUs: 'X' }, headers)
    expect(r404.status).toBe(404)
    await expect(r404.json()).resolves.toMatchObject({ error: 'nao_encontrado' })
    expect((await merge('inexistente', { target: 'italiana' }, headers)).status).toBe(404)
    expect((await reject('inexistente', headers)).status).toBe(404)
  })
})

// ── GATING por papel ─────────────────────────────────────────────────────────
describe('gating — curador+', () => {
  it('anon → 401; usuario → 403; curador → 200; admin → 200 (admin>=curador) por ação', async () => {
    await insertTerm('g-anon', 'suggested')
    await insertTerm('g-user', 'suggested')
    await insertTerm('g-cur', 'suggested')
    await insertTerm('g-adm', 'suggested')

    // anon → 401
    expect((await getQueue()).status).toBe(401)
    expect((await approve('g-anon', { labelPtBr: 'X', labelEnUs: 'X' })).status).toBe(401)
    expect((await merge('g-anon', { target: 'italiana' })).status).toBe(401)
    expect((await reject('g-anon')).status).toBe(401)

    // usuario → 403
    const u = (await seedSessionHeaders({ email: 'g-u@cur.test', role: 'usuario' })).headers
    expect((await getQueue(u)).status).toBe(403)
    expect((await approve('g-user', { labelPtBr: 'X', labelEnUs: 'X' }, u)).status).toBe(403)
    expect((await merge('g-user', { target: 'italiana' }, u)).status).toBe(403)
    expect((await reject('g-user', u)).status).toBe(403)

    // curador → 200
    const c = await curadorHeaders('g-c@cur.test')
    expect((await getQueue(c)).status).toBe(200)
    expect((await approve('g-cur', { labelPtBr: 'Curada', labelEnUs: 'Curated' }, c)).status).toBe(200)

    // admin → 200 (admin >= curador passa o gate)
    const a = (await seedSessionHeaders({ email: 'g-a@cur.test', role: 'admin' })).headers
    expect((await getQueue(a)).status).toBe(200)
    expect((await reject('g-adm', a)).status).toBe(200)
  })
})

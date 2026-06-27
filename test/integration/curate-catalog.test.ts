import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { POST as createRoute } from '@/app/api/curate/recipes/route'
import { PATCH as editRoute } from '@/app/api/curate/recipes/[id]/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder, type Embedder } from '@/server/embedding/embedder'
import { recipe, recipeTranslation, recipeIngredient, recipeEmbedding, recipeTag, tag } from '@/db/schema'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedEmbedding, seedRecipeTag } from '../helpers/recipes'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'

/**
 * Curadoria de CATÁLOGO editorial (issue #19) — AC1 create/edit/organizar + AC6 stale —
 * pela porta MAIS ALTA (route handlers reais, Request cru, params Promise do Next 15).
 * `setup.ts` aponta o DI para o Postgres descartável e trunca antes de cada teste.
 */

const DIM = 1536

/** Embedder-spy: conta chamadas e delega ao FakeEmbedder(1536). Copiado de translation-edit. */
class CountingEmbedder implements Embedder {
  calls = 0
  private readonly inner = new FakeEmbedder(DIM)
  async embed(text: string): Promise<number[]> {
    this.calls++
    return this.inner.embed(text)
  }
}

function withJson(base?: Headers): Headers {
  const h = base ? new Headers(base) : new Headers()
  h.set('content-type', 'application/json')
  return h
}

async function curadorHeaders(): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
  return headers
}

function create(body: unknown, headers?: Headers): Promise<Response> {
  return createRoute(
    new Request('http://localhost/api/curate/recipes', {
      method: 'POST',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
  )
}

function edit(id: string, body: unknown, headers?: Headers): Promise<Response> {
  return editRoute(
    new Request(`http://localhost/api/curate/recipes/${id}`, {
      method: 'PATCH',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

function getRecipe(id: string, locale: string): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}?locale=${encodeURIComponent(locale)}`), {
    params: Promise.resolve({ id }),
  })
}

// #316: a validação de cozinha lê `vocabulary_term` (DB-direto). `truncateAll` apaga as linhas
// antes de cada teste, então re-semeamos — senão 'brasileira'/'italiana'/'japonesa' seriam recusadas.
beforeEach(async () => {
  await seedVocabularyCozinhas(getDb())
})

const validCreateBody = {
  originalLocale: 'pt-BR',
  titulo: 'Feijoada de catálogo',
  descricao: 'Editorial.',
  passos: ['Passo 1', 'Passo 2'],
  notas: 'Sirva com arroz.',
  cozinha: 'brasileira',
  categoria: 'prato_principal',
  restricoes: ['sem_gluten'],
  porcoes: 6,
  dificuldade: 3,
  ingredientes: [
    { rawText: 'feijão preto', quantidade: '2.500', unidade: 'kg' },
    { rawText: 'sal a gosto', quantidade: null, unidade: 'a_gosto' },
  ],
}

describe('POST /api/curate/recipes #19 — AC1 create', () => {
  it('matriz de gating', async () => {
    // sem sessão → 401
    const r401 = await create(validCreateBody)
    expect(r401.status).toBe(401)
    expect(await r401.json()).toEqual({ error: 'nao_autenticado' })

    // role usuario → 403
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    const r403 = await create(validCreateBody, u)
    expect(r403.status).toBe(403)
    expect(await r403.json()).toEqual({ error: 'papel_insuficiente' })

    // role curador → 200
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await create(validCreateBody, c)).status).toBe(200)

    // role admin → 200
    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await create(validCreateBody, a)).status).toBe(200)

    // conta soft-deletada → 401
    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const rDel = await create(validCreateBody, d)
    expect(rDel.status).toBe(401)
    expect(await rDel.json()).toEqual({ error: 'conta_desativada' })
  })

  it('happy: cria catálogo (origin=catalog, owner NULL, private, escrita_por_pessoa, itens)', async () => {
    const headers = await curadorHeaders()
    const res = await create(validCreateBody, headers)
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }
    expect(typeof id).toBe('string')

    const db = getDb()
    const [r] = await db
      .select({
        origin: recipe.origin,
        ownerId: recipe.ownerId,
        visibility: recipe.visibility,
        resultKind: recipe.resultKind,
        originalLocale: recipe.originalLocale,
        cozinha: recipe.cozinha,
        categoria: recipe.categoria,
        restricoes: recipe.restricoes,
        porcoes: recipe.porcoes,
        dificuldade: recipe.dificuldade,
      })
      .from(recipe)
      .where(eq(recipe.id, id))
    expect(r.origin).toBe('catalog')
    expect(r.ownerId).toBeNull()
    expect(r.visibility).toBe('private') // owner-NULL abre a leitura; NÃO public
    expect(r.resultKind).toBe('success')
    expect(r.originalLocale).toBe('pt-BR')
    expect(r.cozinha).toBe('brasileira')
    expect(r.categoria).toBe('prato_principal')
    expect(r.restricoes).toEqual(['sem_gluten'])
    expect(r.porcoes).toBe(6)
    expect(r.dificuldade).toBe(3)

    const [tr] = await db
      .select({
        titulo: recipeTranslation.titulo,
        descricao: recipeTranslation.descricao,
        passos: recipeTranslation.passos,
        notas: recipeTranslation.notas,
        slug: recipeTranslation.slug,
        provenance: recipeTranslation.provenance,
        stale: recipeTranslation.stale,
      })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'pt-BR')))
    expect(tr.titulo).toBe('Feijoada de catálogo')
    expect(tr.descricao).toBe('Editorial.')
    expect(tr.passos).toEqual(['Passo 1', 'Passo 2'])
    expect(tr.notas).toBe('Sirva com arroz.')
    // Slug por idioma (#229): materializado NA CRIAÇÃO (write-path), congelado do título do locale —
    // não fica NULL esperando o backfill.
    expect(tr.slug).toBe('feijoada-de-catalogo')
    expect(tr.provenance).toBe('escrita_por_pessoa')
    expect(tr.stale).toBe(false)

    const items = await db
      .select({
        ordem: recipeIngredient.ordem,
        quantidade: recipeIngredient.quantidade,
        unidade: recipeIngredient.unidade,
        rawText: recipeIngredient.rawText,
        ingredientId: recipeIngredient.ingredientId,
      })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, id))
      .orderBy(recipeIngredient.ordem)
    expect(items).toHaveLength(2)
    expect(items[0].ordem).toBe(0)
    expect(items[0].quantidade).toBe('2.500') // STRING, nunca number
    expect(items[0].unidade).toBe('kg')
    expect(items[0].ingredientId).toBeNull()
    expect(items[1].quantidade).toBeNull()
    expect(items[1].unidade).toBe('a_gosto')

    // sem embedding (nasce ausente/dormente)
    const ems = await db.select({ locale: recipeEmbedding.locale }).from(recipeEmbedding).where(eq(recipeEmbedding.recipeId, id))
    expect(ems).toHaveLength(0)
  })

  it('read-back pela porta alta: GET expõe origin catalog + ingredientes', async () => {
    const headers = await curadorHeaders()
    const { id } = (await (await create(validCreateBody, headers)).json()) as { id: string }
    const res = await getRecipe(id, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as { origin: string; ingredients: unknown[] }
    expect(view.origin).toBe('catalog')
    expect(view.ingredients).toHaveLength(2)
  })

  it('validação: titulo ausente → 400; originalLocale inválido → 400; enum inválido → 400', async () => {
    const headers = await curadorHeaders()

    const noTitle = await create({ ...validCreateBody, titulo: '' }, headers)
    expect(noTitle.status).toBe(400)
    expect(await noTitle.json()).toEqual({ error: 'dados_invalidos' })

    const badLocale = await create({ ...validCreateBody, originalLocale: 'fr-FR' }, headers)
    expect(badLocale.status).toBe(400)

    const badLocaleCru = await create({ ...validCreateBody, originalLocale: 'pt-br' }, headers)
    expect(badLocaleCru.status).toBe(200) // canonicalLocale aceita 'pt-br' → 'pt-BR'

    // slug NÃO-ativo (fora do vocabulário) → 400 dados_invalidos (controle: rejeição é por
    // pertencimento ao conjunto ativo, não por enum — o pgEnum foi dropado na virada #318).
    const badCozinha = await create({ ...validCreateBody, cozinha: 'klingon' }, headers)
    expect(badCozinha.status).toBe(400)
    expect(await badCozinha.json()).toEqual({ error: 'dados_invalidos' })

    // #318 (virada): 'americana' está ATIVA na tabela e — desde a virada enum→text+FK — é STORÁVEL.
    // Agora é ACEITA (200) e persiste cozinha='americana' (era 400 cozinha_invalida via enum-bounding).
    const americana = await create({ ...validCreateBody, cozinha: 'americana' }, headers)
    expect(americana.status).toBe(200)
    const { id: americanaId } = (await americana.json()) as { id: string }
    const [americanaRow] = await getDb()
      .select({ cozinha: recipe.cozinha })
      .from(recipe)
      .where(eq(recipe.id, americanaId))
    expect(americanaRow.cozinha).toBe('americana')

    const badUnidade = await create(
      { ...validCreateBody, ingredientes: [{ rawText: 'x', quantidade: null, unidade: 'galao' }] },
      headers,
    )
    expect(badUnidade.status).toBe(400)

    const empty = await create({}, headers)
    expect(empty.status).toBe(400)
  })

  it('validação de faixa (MF-B1): porcoes/dificuldade fora da faixa canônica → 400; borda in-range → 200', async () => {
    const headers = await curadorHeaders()

    // dificuldade fora da faixa 1-5.
    expect((await create({ ...validCreateBody, dificuldade: 0 }, headers)).status).toBe(400)
    expect((await create({ ...validCreateBody, dificuldade: 9999 }, headers)).status).toBe(400)
    // porcoes fora da faixa 1-50.
    expect((await create({ ...validCreateBody, porcoes: -5 }, headers)).status).toBe(400)
    expect((await create({ ...validCreateBody, porcoes: 1000000 }, headers)).status).toBe(400)

    // bordas in-range → sucesso (prova que a rejeição é de FAIXA, não de presença).
    expect((await create({ ...validCreateBody, dificuldade: 5, porcoes: 50 }, headers)).status).toBe(200)
    expect((await create({ ...validCreateBody, dificuldade: 1, porcoes: 1 }, headers)).status).toBe(200)
  })

  it('simetria de tipo (SEC3): descricao/notas de tipo errado no create → 400', async () => {
    const headers = await curadorHeaders()
    expect((await create({ ...validCreateBody, descricao: 123 }, headers)).status).toBe(400)
    expect((await create({ ...validCreateBody, notas: { x: 1 } }, headers)).status).toBe(400)
  })
})

describe('PATCH /api/curate/recipes/[id] #19 — AC1 organizar + AC6 stale', () => {
  it('matriz de gating', async () => {
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'X', provenance: 'escrita_por_pessoa' })
    const body = { cozinha: 'italiana' }

    const r401 = await edit(id, body)
    expect(r401.status).toBe(401)
    expect(await r401.json()).toEqual({ error: 'nao_autenticado' })

    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    const r403 = await edit(id, body, u)
    expect(r403.status).toBe(403)

    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await edit(id, body, c)).status).toBe(200)

    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await edit(id, body, a)).status).toBe(200)

    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const rDel = await edit(id, body, d)
    expect(rDel.status).toBe(401)
    expect(await rDel.json()).toEqual({ error: 'conta_desativada' })
  })

  it('guards: id malformado → 404; receita inexistente → 404', async () => {
    const headers = await curadorHeaders()
    expect((await edit('not-a-uuid', { cozinha: 'italiana' }, headers)).status).toBe(404)
    expect((await edit(crypto.randomUUID(), { cozinha: 'italiana' }, headers)).status).toBe(404)
  })

  it('gate origin=catalog: editar receita de comunidade → 404 leak-safe, conteúdo intacto', async () => {
    const headers = await curadorHeaders()
    const { userId } = await seedSessionHeaders({ email: `o-${crypto.randomUUID()}@ex.com` })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: userId, cozinha: 'japonesa' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Comunidade', provenance: 'escrita_por_pessoa' })

    const res = await edit(id, { cozinha: 'italiana', titulo: 'Hackeado' }, headers)
    expect(res.status).toBe(404)

    const db = getDb()
    const [r] = await db.select({ cozinha: recipe.cozinha }).from(recipe).where(eq(recipe.id, id))
    expect(r.cozinha).toBe('japonesa') // intacto
    const [tr] = await db.select({ titulo: recipeTranslation.titulo }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(tr.titulo).toBe('Comunidade') // intacto
  })

  it('AC6 traduzível: PATCH titulo (pt-BR) ⇒ stale tradução + 1 re-embed; embedding stale limpo; en-US intocada', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Antigo', descricao: 'D', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: 'Old', descricao: 'D', provenance: 'automatica_revisada' })
    await seedEmbedding({ recipeId: id, locale: 'pt-BR', stale: true }) // SEMEAR stale:true (não-vácuo)
    await seedEmbedding({ recipeId: id, locale: 'en-US', stale: true }) // controle: stale:true DEVE permanecer (edit pt-BR não toca en-US)

    const res = await edit(id, { titulo: 'Novo título', locale: 'pt-BR' }, headers)
    expect(res.status).toBe(200)

    expect(spy.calls).toBe(1) // só o locale editado re-embedado

    const db = getDb()
    const [trPt] = await db.select({ stale: recipeTranslation.stale, titulo: recipeTranslation.titulo }).from(recipeTranslation).where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'pt-BR')))
    expect(trPt.stale).toBe(true) // tradução fica stale (monotônico)
    expect(trPt.titulo).toBe('Novo título') // o texto mudou

    const [emPt] = await db.select({ stale: recipeEmbedding.stale }).from(recipeEmbedding).where(and(eq(recipeEmbedding.recipeId, id), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(emPt.stale).toBe(false) // recompute LIMPOU o stale do embedding (não-vácuo: era true)

    const [trEn] = await db.select({ stale: recipeTranslation.stale }).from(recipeTranslation).where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
    expect(trEn.stale).toBe(false)
    const [emEn] = await db.select({ stale: recipeEmbedding.stale }).from(recipeEmbedding).where(and(eq(recipeEmbedding.recipeId, id), eq(recipeEmbedding.locale, 'en-US')))
    expect(emEn.stale).toBe(true) // controle FORTE: era stale:true e PERMANECE (edit pt-BR não re-embeda en-US)
  })

  it('GATE de tradução: PATCH titulo num locale SEM linha → 404; pt-BR intocada; nenhuma linha en-US criada', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Só pt', provenance: 'escrita_por_pessoa' })

    const res = await edit(id, { titulo: 'Novo', locale: 'en-US' }, headers)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(spy.calls).toBe(0)

    const db = getDb()
    const rows = await db.select({ locale: recipeTranslation.locale, titulo: recipeTranslation.titulo }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(rows).toHaveLength(1) // nenhuma linha en-US criada
    expect(rows[0].locale).toBe('pt-BR')
    expect(rows[0].titulo).toBe('Só pt') // intocada
  })

  it('body.locale não-canônico → 404 ANTES de delegar; pt-BR intocada', async () => {
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Original', provenance: 'escrita_por_pessoa' })

    const fr = await edit(id, { titulo: 'X', locale: 'fr-FR' }, headers)
    expect(fr.status).toBe(404)

    const db = getDb()
    const [tr] = await db.select({ titulo: recipeTranslation.titulo }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(tr.titulo).toBe('Original')
  })

  it('AC1 organizar / invariante = no-op de stale; categorização atualizada', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha: 'italiana', porcoes: 2 })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'T', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: id, locale: 'pt-BR' })

    const res = await edit(id, { cozinha: 'japonesa', categoria: 'sobremesa', restricoes: ['vegano'], porcoes: 8, dificuldade: 4 }, headers)
    expect(res.status).toBe(200)
    expect(spy.calls).toBe(0)

    const db = getDb()
    const [r] = await db.select({ cozinha: recipe.cozinha, categoria: recipe.categoria, restricoes: recipe.restricoes, porcoes: recipe.porcoes, dificuldade: recipe.dificuldade }).from(recipe).where(eq(recipe.id, id))
    expect(r.cozinha).toBe('japonesa')
    expect(r.categoria).toBe('sobremesa')
    expect(r.restricoes).toEqual(['vegano'])
    expect(r.porcoes).toBe(8)
    expect(r.dificuldade).toBe(4)

    const [tr] = await db.select({ stale: recipeTranslation.stale }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(tr.stale).toBe(false)
    const [em] = await db.select({ stale: recipeEmbedding.stale }).from(recipeEmbedding).where(eq(recipeEmbedding.recipeId, id))
    expect(em.stale).toBe(false)
  })

  it('organizar tags: (re)liga via recipe_tag por nome normalizado', async () => {
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'T', provenance: 'escrita_por_pessoa' })
    await seedRecipeTag(id, 'antiga') // será removida pelo full-replace

    const res = await edit(id, { tags: ['Leve', 'Saudável'] }, headers)
    expect(res.status).toBe(200)

    const db = getDb()
    const rows = await db
      .select({ nome: tag.nome })
      .from(recipeTag)
      .innerJoin(tag, eq(tag.id, recipeTag.tagId))
      .where(eq(recipeTag.recipeId, id))
    const nomes = rows.map((r) => r.nome).sort()
    expect(nomes).toEqual(['leve', 'saudável']) // lower+trim; 'antiga' removida
  })

  it('validação de faixa (MF-B1): PATCH porcoes/dificuldade fora da faixa → 400; borda in-range → 200; recipe intacto', async () => {
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, porcoes: 6, dificuldade: 3 })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'T', provenance: 'escrita_por_pessoa' })

    expect((await edit(id, { dificuldade: 0 }, headers)).status).toBe(400)
    expect((await edit(id, { dificuldade: 9999 }, headers)).status).toBe(400)
    expect((await edit(id, { porcoes: -5 }, headers)).status).toBe(400)
    expect((await edit(id, { porcoes: 1000000 }, headers)).status).toBe(400)

    // valores fora-de-range NÃO escrevem nada (rejeitados na borda).
    const db = getDb()
    const [r0] = await db.select({ porcoes: recipe.porcoes, dificuldade: recipe.dificuldade }).from(recipe).where(eq(recipe.id, id))
    expect(r0.porcoes).toBe(6)
    expect(r0.dificuldade).toBe(3)

    // bordas in-range → 200 e persistem.
    expect((await edit(id, { dificuldade: 5, porcoes: 50 }, headers)).status).toBe(200)
    const [r1] = await db.select({ porcoes: recipe.porcoes, dificuldade: recipe.dificuldade }).from(recipe).where(eq(recipe.id, id))
    expect(r1.porcoes).toBe(50)
    expect(r1.dificuldade).toBe(5)
  })

  it('AC6 composto: PATCH titulo + cozinha ⇒ stale=true + 1 re-embed (traduzível domina)', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const headers = await curadorHeaders()
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha: 'italiana' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Antigo', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: id, locale: 'pt-BR', stale: true })

    const res = await edit(id, { titulo: 'Novo', cozinha: 'japonesa' }, headers)
    expect(res.status).toBe(200)
    expect(spy.calls).toBe(1)

    const db = getDb()
    const [tr] = await db.select({ stale: recipeTranslation.stale }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(tr.stale).toBe(true)
    const [r] = await db.select({ cozinha: recipe.cozinha }).from(recipe).where(eq(recipe.id, id))
    expect(r.cozinha).toBe('japonesa')
  })
})

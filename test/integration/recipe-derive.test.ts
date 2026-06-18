import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipe, recipeIngredient, recipeTranslation } from '@/db/schema'
import { POST as deriveRoute } from '@/app/api/recipes/[id]/derive/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import type { DerivedDiff } from '@/domain/recipe-diff'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedIngredient } from '../helpers/recipes'

/**
 * Receita DERIVADA (#17) — editar uma receita NÃO-própria FORKA uma nova linha do leitor,
 * com diff CONGELADO + snapshot completo; a base fica byte-inalterada e re-forkável. Porta mais
 * alta (handler POST). `setup.ts` aponta o DI para o Postgres descartável e trunca por teste.
 * Modelo: recipes-publish.test.ts.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

type EditsBody = {
  titulo: string
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
  ingredientes?: { rawText: string | null; quantidade: string | null; unidade?: string | null }[]
  restricoes?: string[]
}

function derive(
  id: string,
  edits: EditsBody | undefined,
  headers?: Headers,
  locale?: string,
): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return deriveRoute(
    new Request(`http://localhost/api/recipes/${id}/derive${qs}`, {
      method: 'POST',
      headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
      body: edits === undefined ? undefined : JSON.stringify({ edits }),
    }),
    { params: Promise.resolve({ id }) },
  )
}

function get(id: string, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return recipeGet(new Request(`http://localhost/api/recipes/${id}${qs}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

type RecipeState = {
  origin: string
  ownerId: string | null
  visibility: string
  resultKind: string
  parentRecipeId: string | null
  lineageKind: string | null
  derivedDiff: DerivedDiff | null
  restricoes: string[]
}

async function readState(id: string): Promise<RecipeState> {
  const [row] = await getDb()
    .select({
      origin: recipe.origin,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      parentRecipeId: recipe.parentRecipeId,
      lineageKind: recipe.lineageKind,
      derivedDiff: recipe.derivedDiff,
      restricoes: recipe.restricoes,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row as RecipeState
}

async function countRecipes(): Promise<number> {
  const [r] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM recipe`
  return r.c
}

/** Ingredientes (ordem, quantidade, raw_text) de uma receita, ordenados — prova de snapshot. */
async function readIngredients(
  id: string,
): Promise<{ ordem: number; quantidade: string | null; rawText: string | null }[]> {
  return getDb()
    .select({
      ordem: recipeIngredient.ordem,
      quantidade: recipeIngredient.quantidade,
      rawText: recipeIngredient.rawText,
    })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, id))
    .orderBy(recipeIngredient.ordem, recipeIngredient.id)
}

/** Semeia uma base de CATÁLOGO (ownerId NULL) com 2 ingredientes + restrição sem_gluten. */
async function seedCatalogBase(): Promise<string> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: ['sem_gluten'],
    porcoes: 4,
    dificuldade: 2,
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: 'Pão de queijo',
    descricao: 'Salgadinho mineiro de polvilho.',
    passos: ['Misture.', 'Asse.'],
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, quantidade: '0.500', unidade: 'kg', rawText: 'polvilho' })
  await seedRecipeIngredient({ recipeId: id, ordem: 1, quantidade: null, unidade: 'a_gosto', rawText: 'sal' })
  return id
}

const baseEdits: EditsBody = {
  titulo: 'Pão de queijo turbinado',
  descricao: 'Versão com mais queijo.',
  passos: ['Misture.', 'Asse com capricho.'],
  notas: null,
  ingredientes: [
    { rawText: 'polvilho', quantidade: '0.500', unidade: 'kg' },
    { rawText: 'queijo', quantidade: '0.300', unidade: 'kg' },
  ],
  restricoes: ['sem_gluten'],
}

describe('POST /api/recipes/[id]/derive — Receita DERIVADA (#17)', () => {
  // (a) derivar CATÁLOGO ⇒ nova linha user_edited do leitor; base byte-inalterada.
  it('(a) deriva catálogo ⇒ user_edited/owner=U/edited/parent=base/private/diff set; base intacta', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'derive-catalog@ex.com' })
    const baseId = await seedCatalogBase()
    const baseBefore = await readState(baseId)

    const res = await derive(baseId, baseEdits, headers)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }
    expect(recipeId).not.toBe(baseId)

    const deriv = await readState(recipeId)
    expect(deriv.origin).toBe('user_edited')
    expect(deriv.ownerId).toBe(userId)
    expect(deriv.lineageKind).toBe('edited')
    expect(deriv.parentRecipeId).toBe(baseId)
    expect(deriv.visibility).toBe('private')
    expect(deriv.resultKind).toBe('success') // herdado do catálogo (success)
    expect(deriv.derivedDiff).not.toBeNull()
    expect(deriv.derivedDiff?.ingredientes.adicionados).toEqual(['queijo'])

    // Base BYTE-inalterada.
    expect(await readState(baseId)).toEqual(baseBefore)
  })

  // (b) derivar PÚBLICA de OUTRO usuário ⇒ mesma forma.
  it('(b) deriva pública de outro usuário ⇒ user_edited/owner=U/edited/parent=base', async () => {
    const { userId: ownerA } = await seedSessionHeaders({ email: 'derive-ownerA@ex.com' })
    const { userId: viewerB, headers: headersB } = await seedSessionHeaders({ email: 'derive-viewerB@ex.com' })
    const baseId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: ownerA,
    })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Bolo de fubá', provenance: 'escrita_por_pessoa' })

    const res = await derive(baseId, { titulo: 'Bolo de fubá com erva-doce' }, headersB)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }
    const deriv = await readState(recipeId)
    expect(deriv.origin).toBe('user_edited')
    expect(deriv.ownerId).toBe(viewerB)
    expect(deriv.lineageKind).toBe('edited')
    expect(deriv.parentRecipeId).toBe(baseId)
  })

  // (c) derivar a MESMA base 2× ⇒ duas derivadas distintas, base re-forkável.
  it('(c) deriva a mesma base 2× ⇒ duas derivadas distintas e não-interferentes', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-twice@ex.com' })
    const baseId = await seedCatalogBase()

    const r1 = await derive(baseId, { ...baseEdits, titulo: 'Cópia 1' }, headers)
    const r2 = await derive(baseId, { ...baseEdits, titulo: 'Cópia 2' }, headers)
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    const id1 = ((await r1.json()) as { recipeId: string }).recipeId
    const id2 = ((await r2.json()) as { recipeId: string }).recipeId
    expect(id1).not.toBe(id2)
    expect((await readState(id1)).parentRecipeId).toBe(baseId)
    expect((await readState(id2)).parentRecipeId).toBe(baseId)
  })

  // (d) derivar a PRÓPRIA receita ⇒ 409 (prova a fronteira #21); zero nova linha.
  it('(d) deriva a PRÓPRIA receita ⇒ 409 derivar_da_propria; nenhuma nova linha', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'derive-own@ex.com' })
    const baseId = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Minha', provenance: 'escrita_por_pessoa' })

    const before = await countRecipes()
    const res = await derive(baseId, { titulo: 'Editada' }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'derivar_da_propria' })
    expect(await countRecipes()).toBe(before)
  })

  // (e) derivar PRIVADA de outro ⇒ 404 leak-safe; zero nova linha.
  it('(e) deriva PRIVADA de outro usuário ⇒ 404 not_found; nenhuma nova linha', async () => {
    const { userId: ownerA } = await seedSessionHeaders({ email: 'derive-privA@ex.com' })
    const { headers: headersB } = await seedSessionHeaders({ email: 'derive-privB@ex.com' })
    const baseId = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId: ownerA })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Privada', provenance: 'escrita_por_pessoa' })

    const before = await countRecipes()
    const res = await derive(baseId, { titulo: 'Editada' }, headersB)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
    expect(await countRecipes()).toBe(before)
  })

  // (f) Visitante (sem sessão) ⇒ 401; ZERO nova linha.
  it('(f) Visitante (sem sessão) ⇒ 401 nao_autenticado; nenhuma nova linha', async () => {
    const baseId = await seedCatalogBase()
    const before = await countRecipes()
    const res = await derive(baseId, baseEdits) // sem headers
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await countRecipes()).toBe(before)
  })

  // (g) snapshot: ingredientes da derivada == os ENVIADOS, mesmo após editar a base DEPOIS.
  it('(g) snapshot: ingredientes da derivada sobrevivem a uma edição posterior da base', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-snapshot@ex.com' })
    const baseId = await seedCatalogBase()

    const res = await derive(baseId, baseEdits, headers)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId
    const snapBefore = await readIngredients(recipeId)
    expect(snapBefore.map((i) => i.rawText)).toEqual(['polvilho', 'queijo'])

    // Edita a BASE depois: muda quantidade + adiciona ingrediente cru.
    await getDb()
      .update(recipeIngredient)
      .set({ quantidade: '9.999' })
      .where(eq(recipeIngredient.recipeId, baseId))
    await seedRecipeIngredient({ recipeId: baseId, ordem: 99, rawText: 'intruso' })

    // A derivada NÃO mudou (snapshot, não referência viva).
    expect(await readIngredients(recipeId)).toEqual(snapBefore)
  })

  // (h) frozen-diff: editar a base DEPOIS não muda o derived_diff ARMAZENADO da derivada.
  it('(h) frozen-diff: edição posterior da base não altera o derived_diff armazenado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-frozen@ex.com' })
    const baseId = await seedCatalogBase()

    const res = await derive(baseId, baseEdits, headers)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId
    const diffBefore = (await readState(recipeId)).derivedDiff
    expect(diffBefore).not.toBeNull()

    // Muda a base radicalmente DEPOIS (título + restrição).
    await getDb().update(recipe).set({ restricoes: ['vegano'] }).where(eq(recipe.id, baseId))
    await getDb()
      .update(recipeTranslation)
      .set({ titulo: 'Outro título totalmente diferente' })
      .where(eq(recipeTranslation.recipeId, baseId))

    expect((await readState(recipeId)).derivedDiff).toEqual(diffBefore)
  })

  // (i) diff content + Aviso recomputado: a base sem_gluten tem um item canônico 'trigo'
  //     (alérgeno trigo, FK). Editamos REMOVENDO outro item e MANTENDO o trigo (casa por
  //     rawText ⇒ a FK canônica flui pro snapshot) ⇒ diff esperado E o GET do dono mostra o
  //     Aviso de restrição recomputado (resolveRecipeView chama decideRestrictionNotices de graça).
  it('(i) diff de conteúdo + Aviso recomputado: trigo em base sem_gluten ⇒ diff + Aviso + derivedDiff no GET', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-aviso@ex.com' })
    const trigoId = await seedIngredient({ slug: `trigo-${crypto.randomUUID()}`, alergenos: ['trigo'] })
    const baseId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      ownerId: null,
      restricoes: ['sem_gluten'],
    })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Bolinho', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId: baseId, ingredientId: trigoId, ordem: 0, rawText: 'farinha de trigo' })
    await seedRecipeIngredient({ recipeId: baseId, ordem: 1, rawText: 'fubá' })

    // Edita: remove 'fubá', mantém 'farinha de trigo' (casa rawText ⇒ herda a FK canônica),
    // muda o título. Mantém sem_gluten ⇒ a contradição trigo×sem_gluten persiste na derivada.
    const edits: EditsBody = {
      titulo: 'Bolinho de trigo',
      restricoes: ['sem_gluten'],
      ingredientes: [{ rawText: 'farinha de trigo', quantidade: null }],
    }
    const res = await derive(baseId, edits, headers)
    expect(res.status).toBe(201)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId

    const diff = (await readState(recipeId)).derivedDiff
    expect(diff?.ingredientes.removidos).toEqual(['fubá'])
    expect(diff?.ingredientes.adicionados).toEqual([]) // trigo já existia (matched)
    expect(diff?.campos.titulo).toEqual({ de: 'Bolinho', para: 'Bolinho de trigo' })

    // GET pelo DONO ⇒ owner-gated derivedDiff presente + Aviso recomputado (trigo × sem_gluten).
    const getRes = await get(recipeId, headers)
    expect(getRes.status).toBe(200)
    const view = (await getRes.json()) as {
      derivedDiff?: DerivedDiff
      canManage?: boolean
      avisos?: { restricao: string; alergeno: string }[]
    }
    expect(view.canManage).toBe(true)
    expect(view.derivedDiff?.ingredientes.removidos).toEqual(['fubá'])
    // Aviso recomputado na leitura (a FK de alérgeno sobreviveu ao snapshot).
    expect(view.avisos).toBeDefined()
    expect(view.avisos?.some((a) => a.restricao === 'sem_gluten' && a.alergeno === 'trigo')).toBe(true)
  })

  // (i2) owner-gating do derivedDiff: o GET por NÃO-dono (ou anônimo) NÃO expõe o derivedDiff.
  it('(i2) owner-gating: derivedDiff só aparece no GET do DONO da derivada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-gate-owner@ex.com' })
    const { headers: outroHeaders } = await seedSessionHeaders({ email: 'derive-gate-other@ex.com' })
    const baseId = await seedCatalogBase()
    const res = await derive(baseId, baseEdits, headers)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId

    // Dono ⇒ derivedDiff presente.
    const ownerGet = (await (await get(recipeId, headers)).json()) as { derivedDiff?: DerivedDiff }
    expect(ownerGet.derivedDiff).toBeDefined()

    // Não-dono ⇒ a derivada é PRIVATE de outro ⇒ 404 (nem chega a ver a vista).
    expect((await get(recipeId, outroHeaders)).status).toBe(404)
    // Anônimo ⇒ 404 também.
    expect((await get(recipeId)).status).toBe(404)
  })

  // (j) resultKind herdado: derivar base PLAYFUL ⇒ derivada playful + private (CHECK).
  it('(j) resultKind herdado: base playful ⇒ derivada playful + private', async () => {
    const { userId: ownerA } = await seedSessionHeaders({ email: 'derive-playA@ex.com' })
    const { headers: headersB } = await seedSessionHeaders({ email: 'derive-playB@ex.com' })
    // Base playful PRIVATE de outro... mas privada de outro ⇒ 404. Precisa ser pública OU catálogo.
    // Playful é forçado private (CHECK), logo não pode ser pública de outro. Usamos CATÁLOGO playful.
    const baseId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      ownerId: null,
      resultKind: 'playful',
      visibility: 'private', // playful ⇒ private (CHECK); catálogo é legível por owner-NULL
    })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Receita lúdica', provenance: 'escrita_por_pessoa' })

    const res = await derive(baseId, { titulo: 'Lúdica editada' }, headersB)
    expect(res.status).toBe(201)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId
    const deriv = await readState(recipeId)
    expect(deriv.resultKind).toBe('playful')
    expect(deriv.visibility).toBe('private') // CHECK recipe_playful_private_chk satisfeito
    void ownerA
  })

  // (j2) resultKind herdado: catálogo success ⇒ derivada success.
  it('(j2) resultKind herdado: catálogo success ⇒ derivada success', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-success@ex.com' })
    const baseId = await seedCatalogBase() // resultKind default success
    const res = await derive(baseId, baseEdits, headers)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId
    expect((await readState(recipeId)).resultKind).toBe('success')
  })

  // (k) validação de borda: edits sem titulo ⇒ 400; sem corpo edits ⇒ 400.
  it('(k) edits inválido (sem titulo) ⇒ 400 dados_invalidos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-badedits@ex.com' })
    const baseId = await seedCatalogBase()
    const before = await countRecipes()
    const res = await derive(baseId, { titulo: '' } as EditsBody, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    expect(await countRecipes()).toBe(before)
  })

  it('(k2) restrição inválida no corpo ⇒ 400 dados_invalidos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-badrestr@ex.com' })
    const baseId = await seedCatalogBase()
    const res = await derive(baseId, { titulo: 'X', restricoes: ['nao_existe'] }, headers)
    expect(res.status).toBe(400)
  })

  // (l) id malformado ⇒ 404 (curto-circuito isUuid, sem 500); uuid inexistente ⇒ 404.
  it('(l) id não-uuid ⇒ 404 sem 500; uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-badid@ex.com' })
    const bad = await derive('not-a-uuid', { titulo: 'X' }, headers)
    expect(bad.status).toBe(404)
    const missing = await derive('00000000-0000-0000-0000-000000000000', { titulo: 'X' }, headers)
    expect(missing.status).toBe(404)
  })

  // (n) P0001 defesa: INSERT com origin='user_edited' NÃO dispara o trigger de imutabilidade
  //     (que só age em UPDATE) — a derivação é um INSERT puro e seguro.
  it('(n) P0001 defesa: INSERT origin=user_edited sucede (trigger só em UPDATE)', async () => {
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, result_kind, visibility, lineage_kind)
      VALUES ('user_edited', 'pt-BR', 'success', 'private', 'edited')
      RETURNING id
    `
    expect(inserted).toHaveLength(1)
    // E um UPDATE de origin numa user_edited AINDA dispara P0001 (o trigger segue ativo).
    let err: unknown
    try {
      await sql`UPDATE recipe SET origin = 'catalog' WHERE id = ${inserted[0].id}`
    } catch (e) {
      err = e
    }
    expect((err as { code?: string }).code).toBe('P0001')
  })

  // (m) restrição: a derivada GUARDA as restricoes ENVIADAS (não as da base).
  it('(m) restrição: derivar trocando restricoes grava as enviadas na derivada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'derive-restr@ex.com' })
    const baseId = await seedCatalogBase() // base sem_gluten
    const res = await derive(baseId, { ...baseEdits, restricoes: ['vegano'] }, headers)
    const recipeId = ((await res.json()) as { recipeId: string }).recipeId
    const deriv = await readState(recipeId)
    expect(deriv.restricoes).toEqual(['vegano'])
    expect(deriv.derivedDiff?.restricoes.adicionadas).toEqual(['vegano'])
    expect(deriv.derivedDiff?.restricoes.removidas).toEqual(['sem_gluten'])
  })
})

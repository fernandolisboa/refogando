import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { recipe, recipeIngredient, recipeTranslation } from '@/db/schema'
import { PATCH as patchRoute } from '@/app/api/recipes/[id]/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedIngredient } from '../helpers/recipes'

/**
 * Edição IN-PLACE da PRÓPRIA receita (#21) — editar a sua receita (privada ou pública,
 * inclusive a sua derivada) é um UPDATE da MESMA linha (sem fork). Porta mais alta (handler
 * PATCH). `setup.ts` aponta o DI para o Postgres descartável e trunca por teste. Modelo:
 * recipe-derive.test.ts.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

// Editar campo traduzível ⇒ applyEdit re-embeda (issue #14 seam): plugamos o FakeEmbedder(1536)
// (o RealEmbedder lança "não implementado"). setup.ts faz resetDeps() ANTES deste beforeEach.
beforeEach(() => {
  setEmbedder(new FakeEmbedder(1536))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

type PatchBody = {
  locale?: string
  titulo?: string
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
  cozinha?: string | null
  categoria?: string | null
  restricoes?: string[]
  porcoes?: number | null
  dificuldade?: number | null
  ingredientes?: { rawText: string | null; quantidade: string | null; unidade?: string | null }[]
}

function patch(id: string, body: PatchBody | undefined, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return patchRoute(
    new Request(`http://localhost/api/recipes/${id}${qs}`, {
      method: 'PATCH',
      headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

async function countRecipes(): Promise<number> {
  const [r] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM recipe`
  return r.c
}

async function readTranslation(
  recipeId: string,
  locale: string,
): Promise<{ titulo: string; stale: boolean } | undefined> {
  const [row] = await getDb()
    .select({ titulo: recipeTranslation.titulo, stale: recipeTranslation.stale })
    .from(recipeTranslation)
    .where(eq(recipeTranslation.recipeId, recipeId))
  void locale
  return row
}

async function readIngredientsRaw(id: string): Promise<{ ordem: number; rawText: string | null }[]> {
  return getDb()
    .select({ ordem: recipeIngredient.ordem, rawText: recipeIngredient.rawText })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, id))
    .orderBy(recipeIngredient.ordem, recipeIngredient.id)
}

/** Semeia uma receita PRIVADA do dono `ownerId`, pt-BR, com 1 ingrediente. */
async function seedOwnPrivate(ownerId: string): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId,
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
    descricao: 'Salgadinho mineiro.',
    passos: ['Misture.', 'Asse.'],
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, quantidade: '0.500', unidade: 'kg', rawText: 'polvilho' })
  return id
}

describe('PATCH /api/recipes/[id] — edição IN-PLACE da própria receita (#21)', () => {
  // (a) dono edita a PRÓPRIA receita privada ⇒ MESMA linha atualizada (sem nova linha).
  it('(a) dono edita a própria privada ⇒ mesma linha atualizada in-place (sem fork)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-private@ex.com' })
    const id = await seedOwnPrivate(userId)
    const before = await countRecipes()

    const res = await patch(id, { titulo: 'Pão de queijo turbinado', porcoes: 6 }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    // Nenhuma nova linha (in-place, não fork).
    expect(await countRecipes()).toBe(before)

    // O GET do dono reflete a edição na MESMA receita.
    const view = (await (await get(id, headers)).json()) as { id: string; name: string; porcoes: number | null }
    expect(view.id).toBe(id)
    expect(view.name).toContain('Pão de queijo turbinado')
    expect(view.porcoes).toBe(6)
  })

  // (b) editar campo traduzível ⇒ locale fica stale; só invariante ⇒ NÃO stale.
  it('(b) editar campo traduzível marca o locale stale; editar só invariante NÃO marca', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-stale@ex.com' })
    const id = await seedOwnPrivate(userId)

    // Só invariante (porcoes) ⇒ NÃO stale.
    await patch(id, { porcoes: 8 }, headers)
    expect((await readTranslation(id, 'pt-BR'))?.stale).toBe(false)

    // Traduzível (titulo) ⇒ stale.
    await patch(id, { titulo: 'Outro nome' }, headers)
    expect((await readTranslation(id, 'pt-BR'))?.stale).toBe(true)
  })

  // (c) editar ingredientes (add trigo a uma receita sem_gluten) ⇒ GET mostra o Aviso;
  //     remover ⇒ Aviso some (prova o rewrite from-scratch dos ingredientes).
  it('(c) editar ingredientes recomputa o Aviso de restrição no GET', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-aviso@ex.com' })
    const trigoId = await seedIngredient({ slug: `trigo-${crypto.randomUUID()}`, alergenos: ['trigo'] })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
      restricoes: ['sem_gluten'],
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolinho', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'fubá' })

    // Sem contradição inicial.
    const before = (await (await get(id, headers)).json()) as { avisos?: unknown }
    expect(before.avisos).toBeUndefined()

    // Adiciona 'farinha de trigo' casando o canônico trigo (FK ⇒ alérgeno flui pro Aviso).
    await patch(id, { ingredientes: [{ rawText: 'farinha de trigo', quantidade: null }] }, headers)
    // Liga a FK do item recém-inserido ao canônico trigo (o PATCH grava raw-text-only).
    await getDb().update(recipeIngredient).set({ ingredientId: trigoId }).where(eq(recipeIngredient.recipeId, id))

    const withAviso = (await (await get(id, headers)).json()) as {
      avisos?: { restricao: string; alergeno: string }[]
    }
    expect(withAviso.avisos?.some((a) => a.restricao === 'sem_gluten' && a.alergeno === 'trigo')).toBe(true)

    // Remove o trigo ⇒ Aviso some (rewrite from-scratch, não merge).
    await patch(id, { ingredientes: [{ rawText: 'leite', quantidade: null }] }, headers)
    const cleared = (await (await get(id, headers)).json()) as { avisos?: unknown }
    expect(cleared.avisos).toBeUndefined()
    expect((await readIngredientsRaw(id)).map((i) => i.rawText)).toEqual(['leite'])
  })

  // (d) dono edita a PRÓPRIA PÚBLICA ⇒ was_public:true; terceiro lê o conteúdo atualizado.
  it('(d) dono edita a própria pública ⇒ was_public:true; terceiro lê o conteúdo novo', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-public@ex.com' })
    const { headers: otherHeaders } = await seedSessionHeaders({ email: 'oe-public-other@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo simples', provenance: 'escrita_por_pessoa' })

    const res = await patch(id, { titulo: 'Bolo de cenoura' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, was_public: true })

    // Terceiro (não-dono) lê a pública atualizada.
    const view = (await (await get(id, otherHeaders)).json()) as { name: string }
    expect(view.name).toContain('Bolo de cenoura')
  })

  // (e) own private ⇒ was_public:false na resposta.
  it('(e) editar a própria privada ⇒ was_public:false', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-waspriv@ex.com' })
    const id = await seedOwnPrivate(userId)
    const res = await patch(id, { titulo: 'Novo' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, was_public: false })
  })

  // (f) NÃO-dono ⇒ 404 leak-safe; Visitante ⇒ 401; catálogo (ownerId NULL) ⇒ 404; linha intacta.
  it('(f) não-dono ⇒ 404; Visitante ⇒ 401; catálogo ⇒ 404; linha inalterada', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-ownerA@ex.com' })
    const { headers: otherHeaders } = await seedSessionHeaders({ email: 'oe-ownerB@ex.com' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: userId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Intocável', provenance: 'escrita_por_pessoa' })

    // Não-dono ⇒ 404 (nunca 403).
    const nonOwner = await patch(id, { titulo: 'Hackeada' }, otherHeaders)
    expect(nonOwner.status).toBe(404)
    await expect(nonOwner.json()).resolves.toMatchObject({ error: 'not_found' })

    // Visitante ⇒ 401.
    const visitor = await patch(id, { titulo: 'Hackeada' })
    expect(visitor.status).toBe(401)
    await expect(visitor.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    // Catálogo (ownerId NULL) ⇒ 404 mesmo para o dono autenticado.
    const catalogId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: catalogId, locale: 'pt-BR', titulo: 'Catálogo', provenance: 'escrita_por_pessoa' })
    const catalog = await patch(catalogId, { titulo: 'Editado' }, headers)
    expect(catalog.status).toBe(404)

    // A linha original ficou intacta.
    expect((await readTranslation(id, 'pt-BR'))?.titulo).toBe('Intocável')
  })

  // (g) PATCH a um locale inexistente ⇒ 'translation_not_found' ⇒ 404 (não no-op silencioso).
  it('(g) PATCH a um locale inexistente ⇒ 404 translation_not_found', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-noloc@ex.com' })
    const id = await seedOwnPrivate(userId) // só pt-BR
    const res = await patch(id, { titulo: 'No EN' }, headers, 'en-US')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'translation_not_found' })
  })

  // (h) editar uma receita PLAYFUL ⇒ continua playful + private (CHECK não estoura).
  it('(h) editar uma playful mantém playful + private', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-playful@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'playful',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Receita lúdica', provenance: 'escrita_por_pessoa' })

    const res = await patch(id, { titulo: 'Lúdica editada', porcoes: 2 }, headers)
    expect(res.status).toBe(200)

    const [row] = await getDb()
      .select({ resultKind: recipe.resultKind, visibility: recipe.visibility })
      .from(recipe)
      .where(eq(recipe.id, id))
    expect(row.resultKind).toBe('playful')
    expect(row.visibility).toBe('private')
  })

  // (i) editar a PRÓPRIA derivada (in-place) ⇒ mesma linha, NÃO cria camada de cópia (#293).
  it('(i) editar a própria derivada é in-place (não vira mais uma camada de cópia)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-deriv@ex.com' })
    const id = await seedRecipe({
      origin: 'user_edited',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
      lineageKind: 'edited',
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Adaptação', provenance: 'escrita_por_pessoa' })
    const before = await countRecipes()

    const res = await patch(id, { titulo: 'Adaptação refinada' }, headers)
    expect(res.status).toBe(200)
    expect(await countRecipes()).toBe(before)
    expect((await readTranslation(id, 'pt-BR'))?.titulo).toBe('Adaptação refinada')
  })

  // (j) corpo inválido ⇒ 400 dados_invalidos (autorizado, forma ruim).
  it('(j) corpo inválido (titulo vazio) ⇒ 400 dados_invalidos', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-bad@ex.com' })
    const id = await seedOwnPrivate(userId)
    const res = await patch(id, { titulo: '' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
  })

  // (k) origin é NUNCA tocado pelo PATCH (allowlist) — o selo de origem sobrevive.
  it('(k) origin permanece inalterado após edição (allowlist nunca toca origin)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oe-origin@ex.com' })
    const id = await seedOwnPrivate(userId) // origin ai_chat
    await patch(id, { titulo: 'X', cozinha: 'italiana', categoria: 'sobremesa' }, headers)
    const [row] = await getDb().select({ origin: recipe.origin }).from(recipe).where(eq(recipe.id, id))
    expect(row.origin).toBe('ai_chat')
  })

  // (l) id malformado ⇒ 404 sem 500; uuid inexistente ⇒ 404.
  it('(l) id não-uuid ⇒ 404; uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'oe-badid@ex.com' })
    expect((await patch('not-a-uuid', { titulo: 'X' }, headers)).status).toBe(404)
    expect((await patch('00000000-0000-0000-0000-000000000000', { titulo: 'X' }, headers)).status).toBe(404)
  })
})

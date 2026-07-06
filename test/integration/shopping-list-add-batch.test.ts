import { describe, it, expect } from 'vitest'
import { shoppingList } from '@/db/schema'
import { getDb } from '@/server/deps'
import { POST as batchPostRoute } from '@/app/api/me/shopping-lists/[listId]/items/batch/route'
import { GET as itemsGetRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'

/**
 * Multi-adicionar N Receitas a UMA Lista numa ação (fatia E, issue #530, ADR-0032 dec.7). Pela
 * porta mais alta (route handler), espelha o modelo de invocação de `shopping-list-add.test.ts`
 * (A2) — este arquivo cobre só o que é NOVO da fatia E: o lote em si (agregação ENTRE as N
 * Receitas do MESMO lote, idempotência do lote, o gate por-Receita dentro do lote sem derrubar as
 * demais, e os limites do body). O merge/agregação em si (chave+unidade, "a gosto", nome
 * normalizado, snapshot) já está coberto pela A2 — reusado aqui, não reprovado.
 */

function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function addBatch(listId: string, recipeIds: unknown, headers?: Headers, locale?: string): Promise<Response> {
  const q = locale ? `?locale=${locale}` : ''
  return batchPostRoute(
    jsonReq(`/api/me/shopping-lists/${listId}/items/batch${q}`, 'POST', headers, { recipeIds }),
    { params: Promise.resolve({ listId }) },
  )
}

function getItems(listId: string, headers?: Headers): Promise<Response> {
  return itemsGetRoute(jsonReq(`/api/me/shopping-lists/${listId}/items`, 'GET', headers), {
    params: Promise.resolve({ listId }),
  })
}

let seq = 0
async function session() {
  return seedSessionHeaders({ email: `slab-${seq++}-${crypto.randomUUID()}@ex.com` })
}
async function seedList(userId: string, name = 'Lista'): Promise<string> {
  const [row] = await getDb().insert(shoppingList).values({ userId, name }).returning({ id: shoppingList.id })
  return row.id
}

type ItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
  sourceRecipeId: string | null
}
type ItemsBody = { list: { id: string; name: string }; items: ItemView[] }
type BatchBody = { ok: true; addedCount: number; skippedCount: number }

async function seedCatalogRecipe(
  ingredients: { rawText: string; quantidade?: string | null; unidade?: string | null }[],
): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Receita de teste', provenance: 'escrita_por_pessoa' })
  let ordem = 0
  for (const ing of ingredients) {
    await seedRecipeIngredient({
      recipeId,
      ordem: ordem++,
      rawText: ing.rawText,
      quantidade: ing.quantidade ?? null,
      unidade: (ing.unidade ?? null) as never,
    })
  }
  return recipeId
}

function byNome(items: ItemView[], nome: string): ItemView | undefined {
  return items.find((i) => i.nome === nome)
}

describe('Multi-adicionar N Receitas à Lista numa ação (#530)', () => {
  it('adiciona 2 Receitas selecionadas numa ação: cada ingrediente entra na base e agrega entre elas', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '200', unidade: 'g' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '100', unidade: 'g' }])

    const res = await addBatch(listId, [recipeA, recipeB], headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as BatchBody
    expect(body).toMatchObject({ ok: true, addedCount: 2, skippedCount: 0 })

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(byNome(items, 'Farinha')).toMatchObject({ quantidade: '300.000', unidade: 'g' })
    // Mesclada de DUAS Receitas do MESMO lote ⇒ proveniência zera (mesma regra da A2, dec.4).
    expect(byNome(items, 'Farinha')?.sourceRecipeId).toBeNull()
  })

  it('1 Receita só (N=1) funciona igual ao fluxo de UMA Receita', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Sal', quantidade: '1', unidade: 'colher_de_cha' }])

    const res = await addBatch(listId, [recipeId], headers)
    expect(res.status).toBe(200)
    expect((await res.json()) as BatchBody).toMatchObject({ addedCount: 1, skippedCount: 0 })
  })

  it('re-adicionar o MESMO lote mescla (idempotente): soma, sem duplicar linha', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Arroz', quantidade: '1', unidade: 'kg' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Feijão', quantidade: '500', unidade: 'g' }])

    await addBatch(listId, [recipeA, recipeB], headers)
    await addBatch(listId, [recipeA, recipeB], headers) // re-adicionar o mesmo lote

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(2)
    expect(byNome(items, 'Arroz')).toMatchObject({ quantidade: '2.000' })
    expect(byNome(items, 'Feijão')).toMatchObject({ quantidade: '1000.000' })
  })

  it('ids duplicados no MESMO body são deduplicados (não dobra a quantidade)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Manteiga', quantidade: '50', unidade: 'g' }])

    const res = await addBatch(listId, [recipeId, recipeId], headers)
    expect((await res.json()) as BatchBody).toMatchObject({ addedCount: 1, skippedCount: 0 })

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(byNome(items, 'Manteiga')).toMatchObject({ quantidade: '50.000' })
  })

  it('gate por-Receita DENTRO do lote: Receita PRIVADA de outro dono é PULADA, as demais entram', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const owner = await session()
    const privada = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: owner.userId,
    })
    await seedTranslation({ recipeId: privada, locale: 'pt-BR', titulo: 'Privada', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId: privada, ordem: 0, rawText: 'Segredo', quantidade: '1', unidade: 'g' })
    const publica = await seedCatalogRecipe([{ rawText: 'Alho', quantidade: '2', unidade: 'dente' }])

    const res = await addBatch(listId, [privada, publica], headers)
    expect(res.status).toBe(200)
    expect((await res.json()) as BatchBody).toMatchObject({ addedCount: 1, skippedCount: 1 })

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(byNome(items, 'Alho')).toBeDefined()
    expect(byNome(items, 'Segredo')).toBeUndefined()
  })

  it('a PRÓPRIA Receita privada PODE entrar no lote (escape-hatch de ownership)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const minhaPrivada = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId: minhaPrivada,
      locale: 'pt-BR',
      titulo: 'Minha privada',
      provenance: 'escrita_por_pessoa',
    })
    await seedRecipeIngredient({ recipeId: minhaPrivada, ordem: 0, rawText: 'Ovo', quantidade: '2', unidade: 'unidade' })

    const res = await addBatch(listId, [minhaPrivada], headers)
    expect((await res.json()) as BatchBody).toMatchObject({ addedCount: 1, skippedCount: 0 })
  })

  it('sem seletor de porções no lote: nunca escala (entra na quantidade BASE, igual ao rawText da Receita)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Leite', quantidade: '200', unidade: 'ml' }])

    await addBatch(listId, [recipeId], headers)
    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    // Base = exatamente o que veio da Receita, sem ratio/escala nenhuma.
    expect(byNome(items, 'Leite')).toMatchObject({ quantidade: '200.000', unidade: 'ml' })
  })

  it('body sem recipeIds (nenhum uuid válido) ⇒ 404 leak-safe', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    expect((await addBatch(listId, [], headers)).status).toBe(404)
    expect((await addBatch(listId, ['not-a-uuid'], headers)).status).toBe(404)
    expect((await addBatch(listId, undefined, headers)).status).toBe(404)
  })

  it('lote acima do teto ⇒ 422 lote_grande_demais', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const ids = Array.from({ length: 51 }, () => crypto.randomUUID())
    const res = await addBatch(listId, ids, headers)
    expect(res.status).toBe(422)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'lote_grande_demais' })
  })

  it('rota exige sessão (401 anônimo)', async () => {
    const someId = crypto.randomUUID()
    expect((await addBatch(someId, [someId])).status).toBe(401)
  })

  it('lista de OUTRO usuário ⇒ 404 leak-safe (nunca chega a olhar as Receitas)', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Sal', quantidade: '1', unidade: 'g' }])

    expect((await addBatch(listB, [recipeId], a.headers)).status).toBe(404)
  })

  it('todas as Receitas do lote são inelegíveis ⇒ 200 com addedCount 0 (no-op válido, não erro)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const somesId = crypto.randomUUID()

    const res = await addBatch(listId, [somesId], headers)
    expect(res.status).toBe(200)
    expect((await res.json()) as BatchBody).toMatchObject({ addedCount: 0, skippedCount: 1 })
  })
})

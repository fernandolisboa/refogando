import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { shoppingList, shoppingListItem } from '@/db/schema'
import { GET as itemsGetRoute, POST as itemsPostRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import {
  PATCH as itemPatchRoute,
  DELETE as itemDeleteRoute,
} from '@/app/api/me/shopping-lists/[listId]/items/[itemId]/route'
import { computeMatchKey } from '@/domain/shopping-list-item'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * Edição à mão da Lista de compras (fatia C, issue #528, ADR-0032 dec.5) — pela porta mais alta
 * (route handlers). `setup.ts` aponta o DI pro Postgres descartável e trunca antes de cada teste.
 * Modelo de invocação: shopping-list-add.test.ts (A2). Cobre: item avulso (nome obrigatório, qtd/
 * unidade opcionais, agrega por nome com as demais linhas), editar quantidade, remover linha, e o
 * gate de dono (401/404 leak-safe).
 */

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function getItems(listId: string, headers?: Headers): Promise<Response> {
  return itemsGetRoute(jsonReq(`/api/me/shopping-lists/${listId}/items`, 'GET', headers), {
    params: Promise.resolve({ listId }),
  })
}
function addAdhoc(
  listId: string,
  body: { nome?: unknown; quantidade?: unknown; unidade?: unknown },
  headers?: Headers,
): Promise<Response> {
  return itemsPostRoute(jsonReq(`/api/me/shopping-lists/${listId}/items`, 'POST', headers, body), {
    params: Promise.resolve({ listId }),
  })
}
function editQuantidade(
  listId: string,
  itemId: string,
  quantidade: unknown,
  headers?: Headers,
): Promise<Response> {
  return itemPatchRoute(
    jsonReq(`/api/me/shopping-lists/${listId}/items/${itemId}`, 'PATCH', headers, { quantidade }),
    { params: Promise.resolve({ listId, itemId }) },
  )
}
function removeItem(listId: string, itemId: string, headers?: Headers): Promise<Response> {
  return itemDeleteRoute(jsonReq(`/api/me/shopping-lists/${listId}/items/${itemId}`, 'DELETE', headers), {
    params: Promise.resolve({ listId, itemId }),
  })
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `sle-${seq++}-${crypto.randomUUID()}@ex.com` })
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
  ingredientId: string | null
  sourceRecipeId: string | null
}
type ItemsBody = { list: { id: string; name: string }; items: ItemView[] }

function byNome(items: ItemView[], nome: string): ItemView | undefined {
  return items.find((i) => i.nome === nome)
}

async function items(listId: string, headers: Headers): Promise<ItemView[]> {
  const body = (await (await getItems(listId, headers)).json()) as ItemsBody
  return body.items
}

// ── Adicionar item avulso ─────────────────────────────────────────────────────
describe('Adicionar item avulso (#528)', () => {
  it('nome obrigatório; quantidade/unidade opcionais (ambas ausentes)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    const res = await addAdhoc(listId, { nome: 'Guardanapos' }, headers)
    expect(res.status).toBe(200)

    const rows = await items(listId, headers)
    expect(rows).toHaveLength(1)
    expect(byNome(rows, 'Guardanapos')).toMatchObject({
      quantidade: null,
      unidade: null,
      ingredientId: null,
      sourceRecipeId: null,
    })
  })

  it('com quantidade e unidade: grava numeric(10,3) + enum', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    const res = await addAdhoc(listId, { nome: 'Açúcar', quantidade: '2.5', unidade: 'kg' }, headers)
    expect(res.status).toBe(200)

    const rows = await items(listId, headers)
    expect(byNome(rows, 'Açúcar')).toMatchObject({ quantidade: '2.500', unidade: 'kg' })
  })

  it('agrega por NOME normalizado com uma linha já existente (mesma chave da A2)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    await addAdhoc(listId, { nome: 'Farinha', quantidade: '200', unidade: 'g' }, headers)
    await addAdhoc(listId, { nome: 'farinha', quantidade: '100', unidade: 'g' }, headers)

    const rows = await items(listId, headers)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ quantidade: '300.000', unidade: 'g' })
  })

  it('nome vazio/ausente ⇒ 400 nome_invalido', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    expect((await addAdhoc(listId, { nome: '   ' }, headers)).status).toBe(400)
    const body = await (await addAdhoc(listId, { nome: '   ' }, headers)).json()
    expect(body).toEqual({ error: 'nome_invalido' })
  })

  it('quantidade inválida (zero/negativa/fora do formato) ⇒ 400 quantidade_invalida', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    expect((await addAdhoc(listId, { nome: 'Sal', quantidade: '0' }, headers)).status).toBe(400)
    expect((await addAdhoc(listId, { nome: 'Sal', quantidade: '-1' }, headers)).status).toBe(400)
    expect((await addAdhoc(listId, { nome: 'Sal', quantidade: 'abc' }, headers)).status).toBe(400)
  })

  it('unidade fora do enum ⇒ 400 unidade_invalida', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)

    const res = await addAdhoc(listId, { nome: 'Sal', unidade: 'garrafa' }, headers)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unidade_invalida' })
  })

  it('lista de OUTRO usuário ⇒ 404 leak-safe (nunca 400, mesmo com corpo inválido)', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)

    expect((await addAdhoc(listB, { nome: 'Sal' }, a.headers)).status).toBe(404)
  })

  it('sem sessão ⇒ 401', async () => {
    const someId = crypto.randomUUID()
    expect((await addAdhoc(someId, { nome: 'Sal' })).status).toBe(401)
  })

  it('mescla com uma linha JÁ vinda de Receita (mesma chave+unidade, #526/A2): soma e zera source_recipe_id', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })

    // Simula uma linha que veio de adicionar-de-Receita (A2): mesma forma de `upsertShoppingListLines`.
    const matchKey = computeMatchKey({ ingredientId: null, nome: 'Farinha' })
    await getDb().insert(shoppingListItem).values({
      listId,
      nome: 'Farinha',
      quantidade: '200',
      unidade: 'g',
      ingredientId: null,
      sourceRecipeId: recipeId,
      matchKey,
    })

    const res = await addAdhoc(listId, { nome: 'farinha', quantidade: '100', unidade: 'g' }, headers)
    expect(res.status).toBe(200)

    const rows = await items(listId, headers)
    expect(rows).toHaveLength(1)
    // Fonte MISTA (Receita + avulso) ⇒ proveniência zera (dec.4: só sobrevive quando bate com a
    // MESMA fonte); a quantidade soma como qualquer merge por (chave, unidade).
    expect(rows[0]).toMatchObject({ quantidade: '300.000', sourceRecipeId: null })
  })
})

// ── Editar quantidade ─────────────────────────────────────────────────────────
describe('Editar a quantidade de uma linha (#528)', () => {
  async function seedItem(headers: Headers, listId: string, nome = 'Farinha'): Promise<string> {
    await addAdhoc(listId, { nome, quantidade: '200', unidade: 'g' }, headers)
    const rows = await items(listId, headers)
    return byNome(rows, nome)!.id
  }

  it('edita pra um novo valor', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(headers, listId)

    const res = await editQuantidade(listId, itemId, '350', headers)
    expect(res.status).toBe(200)

    // numeric(10,3) sempre volta com 3 casas do Postgres (mesma tese de `shopping-list-add.test.ts`).
    const rows = await items(listId, headers)
    expect(rows[0].quantidade).toBe('350.000')
  })

  it('quantidade: null limpa (linha vira "sem número")', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(headers, listId)

    const res = await editQuantidade(listId, itemId, null, headers)
    expect(res.status).toBe(200)

    const rows = await items(listId, headers)
    expect(rows[0].quantidade).toBeNull()
  })

  it('não mexe em nome/unidade — só a quantidade muda', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(headers, listId, 'Camarão')

    await editQuantidade(listId, itemId, '999', headers)

    const rows = await items(listId, headers)
    expect(rows[0]).toMatchObject({ nome: 'Camarão', unidade: 'g', quantidade: '999.000' })
  })

  it('quantidade inválida (zero/negativa/fora do formato) ⇒ 400 quantidade_invalida', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(headers, listId)

    expect((await editQuantidade(listId, itemId, '0', headers)).status).toBe(400)
    expect((await editQuantidade(listId, itemId, '-5', headers)).status).toBe(400)
    expect((await editQuantidade(listId, itemId, 'abc', headers)).status).toBe(400)
  })

  it('item de OUTRA lista ⇒ 404 leak-safe', async () => {
    const { userId, headers } = await session()
    const listA = await seedList(userId, 'A')
    const listB = await seedList(userId, 'B')
    const itemId = await seedItem(headers, listA)

    expect((await editQuantidade(listB, itemId, '10', headers)).status).toBe(404)
  })

  it('lista de OUTRO usuário ⇒ 404 leak-safe', async () => {
    const owner = await session()
    const attacker = await session()
    const listId = await seedList(owner.userId)
    const itemId = await seedItem(owner.headers, listId)

    expect((await editQuantidade(listId, itemId, '10', attacker.headers)).status).toBe(404)
  })

  it('item inexistente ⇒ 404', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    expect((await editQuantidade(listId, crypto.randomUUID(), '10', headers)).status).toBe(404)
  })

  it('sem sessão ⇒ 401', async () => {
    const someId = crypto.randomUUID()
    expect((await editQuantidade(someId, someId, '10')).status).toBe(401)
  })
})

// ── Remover linha ─────────────────────────────────────────────────────────────
describe('Remover uma linha (#528)', () => {
  async function seedItem(headers: Headers, listId: string, nome = 'Farinha'): Promise<string> {
    await addAdhoc(listId, { nome, quantidade: '200', unidade: 'g' }, headers)
    const rows = await items(listId, headers)
    return byNome(rows, nome)!.id
  }

  it('remove a linha; some da GET', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(headers, listId)

    const res = await removeItem(listId, itemId, headers)
    expect(res.status).toBe(200)

    const rows = await items(listId, headers)
    expect(rows).toHaveLength(0)
  })

  it('remove só a linha alvo — as demais permanecem', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const alvo = await seedItem(headers, listId, 'Farinha')
    await seedItem(headers, listId, 'Açúcar')

    await removeItem(listId, alvo, headers)

    const rows = await items(listId, headers)
    expect(rows).toHaveLength(1)
    expect(rows[0].nome).toBe('Açúcar')
  })

  it('item de OUTRA lista ⇒ 404 leak-safe', async () => {
    const { userId, headers } = await session()
    const listA = await seedList(userId, 'A')
    const listB = await seedList(userId, 'B')
    const itemId = await seedItem(headers, listA)

    expect((await removeItem(listB, itemId, headers)).status).toBe(404)
  })

  it('lista de OUTRO usuário ⇒ 404 leak-safe', async () => {
    const owner = await session()
    const attacker = await session()
    const listId = await seedList(owner.userId)
    const itemId = await seedItem(owner.headers, listId)

    expect((await removeItem(listId, itemId, attacker.headers)).status).toBe(404)
  })

  it('item inexistente/já removido ⇒ 404', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    expect((await removeItem(listId, crypto.randomUUID(), headers)).status).toBe(404)
  })

  it('sem sessão ⇒ 401', async () => {
    const someId = crypto.randomUUID()
    expect((await removeItem(someId, someId)).status).toBe(401)
  })
})

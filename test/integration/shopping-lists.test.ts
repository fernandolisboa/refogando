import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { shoppingList } from '@/db/schema'
import { GET as listRoute, POST as createRoute } from '@/app/api/me/shopping-lists/route'
import {
  PATCH as renameRoute,
  DELETE as deleteRoute,
} from '@/app/api/me/shopping-lists/[listId]/route'
import { ensureDefaultShoppingList } from '@/server/shopping-list/shopping-list'
import { DEFAULT_SHOPPING_LIST_NAME } from '@/domain/shopping-list'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Lista de compras — CONTAINER (issue #525, ADR-0032 dec.1), pela porta mais alta (route
 * handlers) + o helper `ensureDefaultShoppingList` direto. `setup.ts` aponta o DI para o Postgres
 * descartável e trunca antes de cada teste. Modelo de invocação: recipes-collections.test.ts.
 * Esta fatia (A1) só cobre o CRUD do container; adicionar-de-receita/agregação é a A2.
 */

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function listLists(headers?: Headers): Promise<Response> {
  return listRoute(jsonReq('/api/me/shopping-lists', 'GET', headers))
}
function createList(name: unknown, headers?: Headers): Promise<Response> {
  return createRoute(jsonReq('/api/me/shopping-lists', 'POST', headers, { name }))
}
function renameList(listId: string, name: unknown, headers?: Headers): Promise<Response> {
  return renameRoute(jsonReq(`/api/me/shopping-lists/${listId}`, 'PATCH', headers, { name }), {
    params: Promise.resolve({ listId }),
  })
}
function deleteList(listId: string, headers?: Headers): Promise<Response> {
  return deleteRoute(jsonReq(`/api/me/shopping-lists/${listId}`, 'DELETE', headers), {
    params: Promise.resolve({ listId }),
  })
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `sl-${seq++}-${crypto.randomUUID()}@ex.com` })
}
async function seedList(userId: string, name: string): Promise<string> {
  const [row] = await getDb()
    .insert(shoppingList)
    .values({ userId, name })
    .returning({ id: shoppingList.id })
  return row.id
}

type List = { id: string; name: string; createdAt: string }
type Summary = { id: string; name: string; createdAt: string; updatedAt: string; itemCount: number }

// ── CRUD de Lista ──────────────────────────────────────────────────────────────
describe('CRUD de Lista de compras', () => {
  it('cria uma lista; aparece na lista com itemCount 0 (lista vazia válida)', async () => {
    const { headers } = await session()
    const res = await createList('Churrasco', headers)
    expect(res.status).toBe(200)
    const { list: created } = (await res.json()) as { list: List }
    expect(created.name).toBe('Churrasco')

    const list = (await (await listLists(headers)).json()) as { lists: Summary[] }
    expect(list.lists).toHaveLength(1)
    expect(list.lists[0]).toMatchObject({ id: created.id, name: 'Churrasco', itemCount: 0 })
  })

  it('nome duplicado ⇒ 409 nome_duplicado', async () => {
    const { headers } = await session()
    expect((await createList('Semana', headers)).status).toBe(200)
    const dup = await createList('Semana', headers)
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toBe('nome_duplicado')
  })

  it('nome vazio/só-espaços ⇒ 400 nome_invalido', async () => {
    const { headers } = await session()
    expect((await createList('', headers)).status).toBe(400)
    const ws = await createList('   ', headers)
    expect(ws.status).toBe(400)
    expect((await ws.json()).error).toBe('nome_invalido')
  })

  it('nome não-string no corpo ⇒ 400 (nunca 500)', async () => {
    const { headers } = await session()
    const res = await createList(42, headers)
    expect(res.status).toBe(400)
  })

  it('cap por usuário: 100 ok, 101ª ⇒ 422 limite_listas', async () => {
    const { userId, headers } = await session()
    const rows = Array.from({ length: 100 }, (_, i) => ({ userId, name: `lista-${i}` }))
    await getDb().insert(shoppingList).values(rows)
    const res = await createList('lista-101', headers)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('limite_listas')
  })

  it('renomeia a própria lista (200); rename pro nome atual é ok', async () => {
    const { userId, headers } = await session()
    const id = await seedList(userId, 'Antigo')
    expect((await renameList(id, 'Novo', headers)).status).toBe(200)
    const same = await renameList(id, 'Novo', headers) // pro próprio nome atual
    expect(same.status).toBe(200)
    const list = (await (await listLists(headers)).json()) as { lists: Summary[] }
    expect(list.lists[0].name).toBe('Novo')
  })

  it('rename para um nome que já existe ⇒ 409 nome_duplicado', async () => {
    const { userId, headers } = await session()
    await seedList(userId, 'A')
    const b = await seedList(userId, 'B')
    const res = await renameList(b, 'A', headers)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('nome_duplicado')
  })

  it('rename inválido ⇒ 400; uuid malformado ⇒ 404', async () => {
    const { userId, headers } = await session()
    const id = await seedList(userId, 'X')
    expect((await renameList(id, '  ', headers)).status).toBe(400)
    expect((await renameList('not-a-uuid', 'Y', headers)).status).toBe(404)
  })

  it('apaga a própria lista (200); some da lista', async () => {
    const { userId, headers } = await session()
    const id = await seedList(userId, 'Some')
    expect((await deleteList(id, headers)).status).toBe(200)
    const list = (await (await listLists(headers)).json()) as { lists: Summary[] }
    expect(list.lists).toHaveLength(0)
  })

  it('apagar lista inexistente/já apagada ⇒ 404', async () => {
    const { headers } = await session()
    const id = crypto.randomUUID()
    expect((await deleteList(id, headers)).status).toBe(404)
  })
})

// ── Privacidade (leak-safe 404 + gate de dono) ───────────────────────────────────
describe('Privacidade entre usuários', () => {
  it('A não renomeia/apaga lista de B (404 leak-safe); a listagem só traz a própria', async () => {
    const a = await session()
    const b = await session()
    const lb = await seedList(b.userId, 'DoB')

    expect((await renameList(lb, 'Hack', a.headers)).status).toBe(404)
    expect((await deleteList(lb, a.headers)).status).toBe(404)

    const listA = (await (await listLists(a.headers)).json()) as { lists: Summary[] }
    expect(listA.lists).toHaveLength(0) // não vê a lista de B

    // B continua com a lista intacta.
    const listB = (await (await listLists(b.headers)).json()) as { lists: Summary[] }
    expect(listB.lists).toHaveLength(1)
    expect(listB.lists[0].name).toBe('DoB')
  })

  it('rotas exigem sessão (401 anônimo)', async () => {
    expect((await listLists()).status).toBe(401)
    expect((await createList('x')).status).toBe(401)
    const someId = crypto.randomUUID()
    expect((await renameList(someId, 'x')).status).toBe(401)
    expect((await deleteList(someId)).status).toBe(401)
  })
})

// ── Lista-padrão (ADR-0032 dec.1) ─────────────────────────────────────────────────
describe('ensureDefaultShoppingList (lista-padrão idempotente)', () => {
  it('cria a lista-padrão no 1º uso', async () => {
    const { userId, headers } = await session()
    const created = await ensureDefaultShoppingList({ db: getDb(), userId })
    expect(created.name).toBe(DEFAULT_SHOPPING_LIST_NAME)

    const list = (await (await listLists(headers)).json()) as { lists: Summary[] }
    expect(list.lists).toHaveLength(1)
    expect(list.lists[0]).toMatchObject({ id: created.id, name: DEFAULT_SHOPPING_LIST_NAME })
  })

  it('chamado 2× NÃO duplica — devolve a MESMA linha', async () => {
    const { userId } = await session()
    const first = await ensureDefaultShoppingList({ db: getDb(), userId })
    const second = await ensureDefaultShoppingList({ db: getDb(), userId })
    expect(second.id).toBe(first.id)

    const rows = await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))
    expect(rows).toHaveLength(1)
  })

  it('não conflita com uma lista-padrão já criada pelo próprio usuário via rota', async () => {
    const { userId, headers } = await session()
    await createList(DEFAULT_SHOPPING_LIST_NAME, headers)
    const ensured = await ensureDefaultShoppingList({ db: getDb(), userId })

    const rows = await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))
    expect(rows).toHaveLength(1)
    expect(ensured.id).toBe(rows[0].id)
  })

  it('lista-padrão de usuários DIFERENTES não colide (UNIQUE é por user_id+name)', async () => {
    const a = await session()
    const b = await session()
    const listA = await ensureDefaultShoppingList({ db: getDb(), userId: a.userId })
    const listB = await ensureDefaultShoppingList({ db: getDb(), userId: b.userId })
    expect(listA.id).not.toBe(listB.id)
  })
})

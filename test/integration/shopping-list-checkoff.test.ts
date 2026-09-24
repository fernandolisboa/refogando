import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { shoppingList, shoppingListItem } from '@/db/schema'
import { GET as itemsGetRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import { DELETE as clearListRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import { DELETE as removeCheckedRoute } from '@/app/api/me/shopping-lists/[listId]/items/checked/route'
import { PATCH as toggleRoute } from '@/app/api/me/shopping-lists/[listId]/items/[itemId]/route'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Check-off PERSISTENTE (fatia D, issue #529, ADR-0032 dec.6) — pela porta mais alta (route
 * handlers). `setup.ts` aponta o DI pro Postgres descartável e trunca antes de cada teste. Modelo
 * de invocação: shopping-list-add.test.ts (A2).
 *
 * Cobre: (1) marcar/desmarcar persiste e a leitura reflete; (2) "remover marcados" apaga só os
 * marcados; (3) "limpar lista" esvazia tudo (marcados e não); (4) nada expira sozinho (sem TTL —
 * o estado sobrevive a múltiplas leituras); (5) gate de dono (404 leak-safe) + 401 anônimo.
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
function toggle(listId: string, itemId: string, checked: unknown, headers?: Headers): Promise<Response> {
  return toggleRoute(
    jsonReq(`/api/me/shopping-lists/${listId}/items/${itemId}`, 'PATCH', headers, { checked }),
    { params: Promise.resolve({ listId, itemId }) },
  )
}
function removeChecked(listId: string, headers?: Headers): Promise<Response> {
  return removeCheckedRoute(
    jsonReq(`/api/me/shopping-lists/${listId}/items/checked`, 'DELETE', headers),
    { params: Promise.resolve({ listId }) },
  )
}
function clearList(listId: string, headers?: Headers): Promise<Response> {
  return clearListRoute(jsonReq(`/api/me/shopping-lists/${listId}/items`, 'DELETE', headers), {
    params: Promise.resolve({ listId }),
  })
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `slco-${seq++}-${crypto.randomUUID()}@ex.com` })
}
async function seedList(userId: string, name = 'Lista'): Promise<string> {
  const [row] = await getDb().insert(shoppingList).values({ userId, name }).returning({ id: shoppingList.id })
  return row.id
}
async function seedItem(listId: string, nome: string, checked = false): Promise<string> {
  const [row] = await getDb()
    .insert(shoppingListItem)
    .values({
      listId,
      nome,
      matchKey: nome.toLowerCase(),
      quantidade: null,
      unidade: null,
      checkedAt: checked ? new Date() : null,
    })
    .returning({ id: shoppingListItem.id })
  return row.id
}

type ItemView = { id: string; nome: string; checkedAt: string | null }
type ItemsBody = { items: ItemView[] }

function byNome(items: ItemView[], nome: string): ItemView | undefined {
  return items.find((i) => i.nome === nome)
}

// ── Marcar/desmarcar persiste ─────────────────────────────────────────────────
describe('Marcar/desmarcar (check-off persistente, #529)', () => {
  it('marca um item: checked_at carimbado; a leitura reflete e sobrevive a recarregar (2ª leitura)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'Arroz')

    const res = await toggle(listId, itemId, true, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; checkedAt: string | null }
    expect(body.checkedAt).not.toBeNull()

    // "recarregar" = uma leitura NOVA e independente — nada expira, o carimbo persiste.
    const first = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(byNome(first.items, 'Arroz')?.checkedAt).not.toBeNull()
    const second = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(byNome(second.items, 'Arroz')?.checkedAt).not.toBeNull()
  })

  it('desmarca um item já marcado: checked_at volta a null', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'Feijão', true)

    const res = await toggle(listId, itemId, false, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { checkedAt: string | null }
    expect(body.checkedAt).toBeNull()

    const items = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(byNome(items.items, 'Feijão')?.checkedAt).toBeNull()
  })

  it('marcar 2× (idempotente): não desmarca, permanece marcado', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'Sal')

    await toggle(listId, itemId, true, headers)
    const second = await toggle(listId, itemId, true, headers)
    expect(second.status).toBe(200)
    const items = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(byNome(items.items, 'Sal')?.checkedAt).not.toBeNull()
  })

  it('checked não-booleano no corpo ⇒ 400 (nunca 500)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'Óleo')
    const res = await toggle(listId, itemId, 'sim', headers)
    expect(res.status).toBe(400)
  })
})

// ── Remover marcados ───────────────────────────────────────────────────────────
describe('"Remover marcados" (#529)', () => {
  it('apaga SÓ os itens marcados; os desmarcados permanecem intactos', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    await seedItem(listId, 'Marcado A', true)
    await seedItem(listId, 'Marcado B', true)
    await seedItem(listId, 'Desmarcado', false)

    const res = await removeChecked(listId, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { removed: number }
    expect(body.removed).toBe(2)

    const items = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items.items).toHaveLength(1)
    expect(items.items[0].nome).toBe('Desmarcado')
  })

  it('lista sem nenhum item marcado: no-op válido (200, removed 0)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    await seedItem(listId, 'Só isso', false)

    const res = await removeChecked(listId, headers)
    expect(res.status).toBe(200)
    expect((await res.json()).removed).toBe(0)

    const items = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items.items).toHaveLength(1)
  })
})

// ── Limpar lista ───────────────────────────────────────────────────────────────
describe('"Limpar lista" (#529)', () => {
  it('apaga TODOS os itens (marcados e não); a Lista sobrevive vazia (não é apagada)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId, 'Sobrevive')
    await seedItem(listId, 'A', true)
    await seedItem(listId, 'B', false)

    const res = await clearList(listId, headers)
    expect(res.status).toBe(200)
    expect((await res.json()).removed).toBe(2)

    const afterClear = await getItems(listId, headers)
    expect(afterClear.status).toBe(200) // a Lista continua existindo — só ficou vazia.
    const body = (await afterClear.json()) as ItemsBody & { list: { name: string } }
    expect(body.list.name).toBe('Sobrevive')
    expect(body.items).toHaveLength(0)
  })
})

// ── Nada expira automaticamente ────────────────────────────────────────────────
describe('Nada expira sozinho (#529 dec.6)', () => {
  it('item marcado permanece marcado e presente sem NENHUMA ação explícita do dono', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'Perene', true)

    // Múltiplas leituras — nenhuma delas é uma ação de "remover"/"limpar"; nada muda sozinho.
    for (let i = 0; i < 3; i++) {
      const items = (await (await getItems(listId, headers)).json()) as ItemsBody
      expect(byNome(items.items, 'Perene')?.checkedAt).not.toBeNull()
    }
    const row = await getDb().select().from(shoppingListItem).where(eq(shoppingListItem.id, itemId))
    expect(row).toHaveLength(1)
  })
})

// ── Gate de dono + sessão ───────────────────────────────────────────────────────
describe('Gate de dono (404 leak-safe) + sessão (401)', () => {
  it('rotas exigem sessão (401 anônimo)', async () => {
    const someId = crypto.randomUUID()
    expect((await toggle(someId, someId, true)).status).toBe(401)
    expect((await removeChecked(someId)).status).toBe(401)
    expect((await clearList(someId)).status).toBe(401)
  })

  it('toggle em item de OUTRO usuário ⇒ 404 leak-safe', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)
    const itemB = await seedItem(listB, 'DoB')

    expect((await toggle(listB, itemB, true, a.headers)).status).toBe(404)

    // O item de B continua desmarcado — o gate barrou ANTES do UPDATE.
    const items = (await (await getItems(listB, b.headers)).json()) as ItemsBody
    expect(byNome(items.items, 'DoB')?.checkedAt).toBeNull()
  })

  it('item de uma lista DIFERENTE (do MESMO usuário) ⇒ 404 (o item não pertence a essa lista)', async () => {
    const { userId, headers } = await session()
    const listA = await seedList(userId, 'A')
    const listB = await seedList(userId, 'B')
    const itemDeA = await seedItem(listA, 'ItemDeA')

    expect((await toggle(listB, itemDeA, true, headers)).status).toBe(404)
  })

  it('"remover marcados"/"limpar lista" em lista de OUTRO usuário ⇒ 404 leak-safe, nada é apagado', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)
    await seedItem(listB, 'Intacto', true)

    expect((await removeChecked(listB, a.headers)).status).toBe(404)
    expect((await clearList(listB, a.headers)).status).toBe(404)

    const items = (await (await getItems(listB, b.headers)).json()) as ItemsBody
    expect(items.items).toHaveLength(1) // nada foi apagado pelo ataque.
  })

  it('uuid malformado (lista OU item) ⇒ 404', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const itemId = await seedItem(listId, 'X')

    expect((await toggle('not-a-uuid', itemId, true, headers)).status).toBe(404)
    expect((await toggle(listId, 'not-a-uuid', true, headers)).status).toBe(404)
    expect((await removeChecked('not-a-uuid', headers)).status).toBe(404)
    expect((await clearList('not-a-uuid', headers)).status).toBe(404)
  })
})

import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, recipeSave, collection, collectionItem } from '@/db/schema'
import { GET as listRoute, POST as createRoute } from '@/app/api/me/collections/route'
import {
  PATCH as renameRoute,
  DELETE as deleteRoute,
} from '@/app/api/me/collections/[collectionId]/route'
import {
  GET as itemsRoute,
  POST as addItemRoute,
} from '@/app/api/me/collections/[collectionId]/items/route'
import { DELETE as removeItemRoute } from '@/app/api/me/collections/[collectionId]/items/[recipeId]/route'
import { GET as savedRoute } from '@/app/api/me/saved/route'
import { GET as membershipRoute } from '@/app/api/recipes/[id]/collections/route'
import { POST as saveRoute } from '@/app/api/recipes/[id]/save/route'
import { POST as unsaveRoute } from '@/app/api/recipes/[id]/unsave/route'
import { seedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedCollection,
  seedRemovedFromPool,
} from '../helpers/recipes'
import type { RecipeListItem } from '@/domain/recipe-list-read'

/**
 * Coleções privadas M:N sobre o Salvar (issue #364, ADR-0027), pela porta mais alta (route
 * handlers). `setup.ts` aponta o DI para o Postgres descartável e trunca antes de cada teste.
 * Modelo de invocação: recipes-social.test.ts (Request cru + params Promise).
 */

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function listCollections(headers?: Headers): Promise<Response> {
  return listRoute(jsonReq('/api/me/collections', 'GET', headers))
}
function createCollection(name: unknown, headers?: Headers): Promise<Response> {
  return createRoute(jsonReq('/api/me/collections', 'POST', headers, { name }))
}
function renameCollection(collectionId: string, name: unknown, headers?: Headers): Promise<Response> {
  return renameRoute(jsonReq(`/api/me/collections/${collectionId}`, 'PATCH', headers, { name }), {
    params: Promise.resolve({ collectionId }),
  })
}
function deleteCollection(collectionId: string, headers?: Headers): Promise<Response> {
  return deleteRoute(jsonReq(`/api/me/collections/${collectionId}`, 'DELETE', headers), {
    params: Promise.resolve({ collectionId }),
  })
}
function getItems(collectionId: string, headers?: Headers): Promise<Response> {
  return itemsRoute(jsonReq(`/api/me/collections/${collectionId}/items`, 'GET', headers), {
    params: Promise.resolve({ collectionId }),
  })
}
function addItem(collectionId: string, recipeId: unknown, headers?: Headers): Promise<Response> {
  return addItemRoute(
    jsonReq(`/api/me/collections/${collectionId}/items`, 'POST', headers, { recipeId }),
    { params: Promise.resolve({ collectionId }) },
  )
}
function removeItem(collectionId: string, recipeId: string, headers?: Headers): Promise<Response> {
  return removeItemRoute(
    jsonReq(`/api/me/collections/${collectionId}/items/${recipeId}`, 'DELETE', headers),
    { params: Promise.resolve({ collectionId, recipeId }) },
  )
}
function getSaved(headers?: Headers): Promise<Response> {
  return savedRoute(jsonReq('/api/me/saved', 'GET', headers))
}
function getMembership(id: string, headers?: Headers): Promise<Response> {
  return membershipRoute(jsonReq(`/api/recipes/${id}/collections`, 'GET', headers), {
    params: Promise.resolve({ id }),
  })
}
function save(id: string, headers?: Headers): Promise<Response> {
  return saveRoute(jsonReq(`/api/recipes/${id}/save`, 'POST', headers), {
    params: Promise.resolve({ id }),
  })
}
function unsave(id: string, headers?: Headers): Promise<Response> {
  return unsaveRoute(jsonReq(`/api/recipes/${id}/unsave`, 'POST', headers), {
    params: Promise.resolve({ id }),
  })
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `col-${seq++}-${crypto.randomUUID()}@ex.com` })
}
/** Catálogo (owner null, approved) — salvável por qualquer um e visível na leitura. */
async function seedCatalog(titulo = 'Bolo'): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}
/** Comunidade PÚBLICA de um dono (savável por outros; visibilidade togglável). */
async function seedPublicOwned(ownerId: string, titulo = 'Torta'): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

// ── Leitores de estado cru ────────────────────────────────────────────────────
async function itemCountRaw(collectionId: string): Promise<number> {
  const rows = await getDb()
    .select()
    .from(collectionItem)
    .where(eq(collectionItem.collectionId, collectionId))
  return rows.length
}
async function itemsForUserRecipe(userId: string, recipeId: string): Promise<number> {
  const rows = await getDb()
    .select({ cid: collectionItem.collectionId })
    .from(collectionItem)
    .innerJoin(collection, eq(collection.id, collectionItem.collectionId))
    .where(and(eq(collection.userId, userId), eq(collectionItem.recipeId, recipeId)))
  return rows.length
}
async function saveExists(userId: string, recipeId: string): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(recipeSave)
    .where(and(eq(recipeSave.userId, userId), eq(recipeSave.recipeId, recipeId)))
  return rows.length > 0
}
async function idsOf(res: Response): Promise<string[]> {
  const body = (await res.json()) as { recipes: RecipeListItem[] }
  return body.recipes.map((r) => r.id)
}

type Collection = { id: string; name: string; createdAt: string }
type Summary = { id: string; name: string; createdAt: string; itemCount: number }

// ── CRUD de Coleção ──────────────────────────────────────────────────────────────
describe('CRUD de Coleção', () => {
  it('cria uma coleção; aparece na lista com itemCount 0 (coleção vazia válida)', async () => {
    const { headers } = await session()
    const res = await createCollection('Massas', headers)
    expect(res.status).toBe(200)
    const { collection: created } = (await res.json()) as { collection: Collection }
    expect(created.name).toBe('Massas')

    const list = (await (await listCollections(headers)).json()) as { collections: Summary[] }
    expect(list.collections).toHaveLength(1)
    expect(list.collections[0]).toMatchObject({ id: created.id, name: 'Massas', itemCount: 0 })
  })

  it('nome duplicado ⇒ 409 nome_duplicado', async () => {
    const { headers } = await session()
    expect((await createCollection('Doces', headers)).status).toBe(200)
    const dup = await createCollection('Doces', headers)
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toBe('nome_duplicado')
  })

  it('nome vazio/só-espaços ⇒ 400 nome_invalido', async () => {
    const { headers } = await session()
    expect((await createCollection('', headers)).status).toBe(400)
    const ws = await createCollection('   ', headers)
    expect(ws.status).toBe(400)
    expect((await ws.json()).error).toBe('nome_invalido')
  })

  it('nome não-string no corpo ⇒ 400 (nunca 500)', async () => {
    const { headers } = await session()
    const res = await createCollection(42, headers)
    expect(res.status).toBe(400)
  })

  it('cap por usuário: 100 ok, 101ª ⇒ 422 limite_colecoes', async () => {
    const { userId, headers } = await session()
    const rows = Array.from({ length: 100 }, (_, i) => ({ userId, name: `pasta-${i}` }))
    await getDb().insert(collection).values(rows)
    const res = await createCollection('pasta-101', headers)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('limite_colecoes')
  })

  it('renomeia a própria coleção (200); rename pro nome atual é ok', async () => {
    const { userId, headers } = await session()
    const id = await seedCollection({ userId, name: 'Antigo' })
    expect((await renameCollection(id, 'Novo', headers)).status).toBe(200)
    const same = await renameCollection(id, 'Novo', headers) // pro próprio nome atual
    expect(same.status).toBe(200)
    const list = (await (await listCollections(headers)).json()) as { collections: Summary[] }
    expect(list.collections[0].name).toBe('Novo')
  })

  it('rename para um nome que já existe ⇒ 409 nome_duplicado', async () => {
    const { userId, headers } = await session()
    await seedCollection({ userId, name: 'A' })
    const b = await seedCollection({ userId, name: 'B' })
    const res = await renameCollection(b, 'A', headers)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('nome_duplicado')
  })

  it('rename inválido ⇒ 400; uuid malformado ⇒ 404', async () => {
    const { userId, headers } = await session()
    const id = await seedCollection({ userId, name: 'X' })
    expect((await renameCollection(id, '  ', headers)).status).toBe(400)
    expect((await renameCollection('not-a-uuid', 'Y', headers)).status).toBe(404)
  })

  it('apaga a própria coleção (200); some da lista', async () => {
    const { userId, headers } = await session()
    const id = await seedCollection({ userId, name: 'Some' })
    expect((await deleteCollection(id, headers)).status).toBe(200)
    const list = (await (await listCollections(headers)).json()) as { collections: Summary[] }
    expect(list.collections).toHaveLength(0)
  })

  it('apagar coleção COM itens: itens somem, os saves PERMANECEM', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    await save(r, headers)
    const c = await seedCollection({ userId, name: 'Guardados' })
    expect((await addItem(c, r, headers)).status).toBe(200)
    expect(await itemCountRaw(c)).toBe(1)

    expect((await deleteCollection(c, headers)).status).toBe(200)
    expect(await itemCountRaw(c)).toBe(0)
    expect(await saveExists(userId, r)).toBe(true) // apagar pasta ≠ dessalvar
  })
})

// ── Privacidade (leak-safe 404) ──────────────────────────────────────────────────
describe('Privacidade entre usuários', () => {
  it('A não renomeia/apaga/edita coleção de B (404 leak-safe); a lista só traz a própria', async () => {
    const a = await session()
    const b = await session()
    const cb = await seedCollection({ userId: b.userId, name: 'DoB' })
    const rb = await seedCatalog()
    await save(rb, b.headers)

    expect((await renameCollection(cb, 'Hack', a.headers)).status).toBe(404)
    expect((await deleteCollection(cb, a.headers)).status).toBe(404)
    expect((await addItem(cb, rb, a.headers)).status).toBe(404)
    expect((await getItems(cb, a.headers)).status).toBe(404)
    expect((await removeItem(cb, rb, a.headers)).status).toBe(404)

    const listA = (await (await listCollections(a.headers)).json()) as { collections: Summary[] }
    expect(listA.collections).toHaveLength(0) // não vê a coleção de B
  })

  it('rotas exigem sessão (401 anônimo)', async () => {
    expect((await listCollections()).status).toBe(401)
    expect((await createCollection('x')).status).toBe(401)
    expect((await getSaved()).status).toBe(401)
  })
})

// ── M:N: adicionar / remover ──────────────────────────────────────────────────────
describe('M:N sobre o Salvar', () => {
  it('adiciona receita salva a 2 coleções; remove de 1 NÃO dessalva nem tira da outra', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    await save(r, headers)
    const c1 = await seedCollection({ userId, name: 'C1' })
    const c2 = await seedCollection({ userId, name: 'C2' })

    expect((await addItem(c1, r, headers)).status).toBe(200)
    expect((await addItem(c2, r, headers)).status).toBe(200)
    expect(await idsOf(await getItems(c1, headers))).toEqual([r])
    expect(await idsOf(await getItems(c2, headers))).toEqual([r])

    expect((await removeItem(c1, r, headers)).status).toBe(200)
    expect(await idsOf(await getItems(c1, headers))).toEqual([]) // saiu de C1
    expect(await idsOf(await getItems(c2, headers))).toEqual([r]) // segue em C2
    expect(await saveExists(userId, r)).toBe(true) // remover-de-coleção ≠ dessalvar
  })

  it('adicionar receita NÃO salva ⇒ 422 nao_salva', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    const c = await seedCollection({ userId, name: 'C' })
    const res = await addItem(c, r, headers)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('nao_salva')
    expect(await itemCountRaw(c)).toBe(0)
  })

  it('adicionar 2× ⇒ idempotente (1 linha)', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    await save(r, headers)
    const c = await seedCollection({ userId, name: 'C' })
    expect((await addItem(c, r, headers)).status).toBe(200)
    expect((await addItem(c, r, headers)).status).toBe(200)
    expect(await itemCountRaw(c)).toBe(1)
  })

  it('add com recipeId malformado ⇒ 404 (nunca 500)', async () => {
    const { userId, headers } = await session()
    const c = await seedCollection({ userId, name: 'C' })
    expect((await addItem(c, 'nope', headers)).status).toBe(404)
  })

  it('remover item é idempotente (no-op se não está) ⇒ 200', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    const c = await seedCollection({ userId, name: 'C' })
    expect((await removeItem(c, r, headers)).status).toBe(200)
  })
})

// ── Cascade ao DESSALVAR ─────────────────────────────────────────────────────────
describe('Dessalvar limpa as coleções (save = fonte da verdade)', () => {
  it('unsave zera os collection_item daquele (user, recipe); outras receitas e OUTRO usuário intactos', async () => {
    const a = await session()
    const b = await session()
    const r1 = await seedCatalog('R1')
    const r2 = await seedCatalog('R2')

    // A salva r1 (em 2 coleções) e r2 (em 1).
    await save(r1, a.headers)
    await save(r2, a.headers)
    const ca1 = await seedCollection({ userId: a.userId, name: 'A1' })
    const ca2 = await seedCollection({ userId: a.userId, name: 'A2' })
    const caR2 = await seedCollection({ userId: a.userId, name: 'A-r2' })
    await addItem(ca1, r1, a.headers)
    await addItem(ca2, r1, a.headers)
    await addItem(caR2, r2, a.headers)

    // B também salva r1 e o põe numa coleção sua.
    await save(r1, b.headers)
    const cb = await seedCollection({ userId: b.userId, name: 'B1' })
    await addItem(cb, r1, b.headers)

    // A dessalva r1.
    expect((await unsave(r1, a.headers)).status).toBe(200)

    expect(await saveExists(a.userId, r1)).toBe(false) // save foi
    expect(await itemsForUserRecipe(a.userId, r1)).toBe(0) // limpou as 2 coleções de A
    expect(await itemsForUserRecipe(a.userId, r2)).toBe(1) // r2 (outra receita) intacta
    expect(await saveExists(a.userId, r2)).toBe(true)
    // O de B (mesma receita r1) NÃO foi tocado.
    expect(await saveExists(b.userId, r1)).toBe(true)
    expect(await itemsForUserRecipe(b.userId, r1)).toBe(1)
  })
})

// ── "Todos" vs subconjunto ────────────────────────────────────────────────────────
describe('"Todos" = todos os saves; coleção = subconjunto', () => {
  it('saved lista todos os saves; a coleção só o subconjunto', async () => {
    const { userId, headers } = await session()
    const r1 = await seedCatalog('R1')
    const r2 = await seedCatalog('R2')
    const r3 = await seedCatalog('R3')
    await save(r1, headers)
    await save(r2, headers)
    await save(r3, headers)
    const c = await seedCollection({ userId, name: 'Favoritas' })
    await addItem(c, r1, headers)
    await addItem(c, r3, headers)

    expect(new Set(await idsOf(await getSaved(headers)))).toEqual(new Set([r1, r2, r3]))
    expect(new Set(await idsOf(await getItems(c, headers)))).toEqual(new Set([r1, r3]))
  })
})

// ── Gate de visibilidade na leitura (C1) ─────────────────────────────────────────
describe('Gate de visibilidade dos salvos (moderação reativa)', () => {
  it('pública de B some quando vira privada/removida MAS o save persiste; a própria-privada de A fica', async () => {
    const a = await session()
    const b = await session()
    const rb = await seedPublicOwned(b.userId, 'De B') // pública de B, salvável por A
    // A própria-privada de A (escape-hatch: dono salva a própria mesmo privada, #362 AC6).
    const ownPriv = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: a.userId,
    })
    await seedTranslation({ recipeId: ownPriv, locale: 'pt-BR', titulo: 'Minha secreta', provenance: 'escrita_por_pessoa' })

    await save(rb, a.headers)
    await save(ownPriv, a.headers)
    const c = await seedCollection({ userId: a.userId, name: 'Mix' })
    await addItem(c, rb, a.headers)

    // Estado inicial: ambas aparecem.
    expect(new Set(await idsOf(await getSaved(a.headers)))).toEqual(new Set([rb, ownPriv]))
    expect(await idsOf(await getItems(c, a.headers))).toEqual([rb])

    // B torna a receita PRIVADA → some da leitura de A, mas o save persiste.
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, rb))
    expect(await idsOf(await getSaved(a.headers))).toEqual([ownPriv]) // rb sumiu
    expect(await idsOf(await getItems(c, a.headers))).toEqual([]) // sumiu da coleção também
    expect(await saveExists(a.userId, rb)).toBe(true) // o save PERSISTE
    expect(await itemCountRaw(c)).toBe(1) // a ARESTA collection_item persiste CRUA (só a leitura filtra)

    // Volta a PÚBLICA → reaparece (leitura, não linha, mudou).
    await getDb().update(recipe).set({ visibility: 'public' }).where(eq(recipe.id, rb))
    expect(new Set(await idsOf(await getSaved(a.headers)))).toEqual(new Set([rb, ownPriv]))
    expect(await idsOf(await getItems(c, a.headers))).toEqual([rb]) // o item REAPARECE na coleção (não foi deletado)

    // Curador REMOVE do pool → some de novo (dimensão ortogonal à visibilidade).
    await seedRemovedFromPool({ recipeId: rb, curatorId: b.userId })
    expect(await idsOf(await getSaved(a.headers))).toEqual([ownPriv])
  })

  it('itemCount da lista de coleções é gateado — o chip bate com a lista aberta (F3)', async () => {
    const a = await session()
    const b = await session()
    const rb = await seedPublicOwned(b.userId, 'Pública de B')
    await save(rb, a.headers)
    const c = await seedCollection({ userId: a.userId, name: 'Gateada' })
    await addItem(c, rb, a.headers)

    const countOf = async (id: string): Promise<number> => {
      const list = (await (await listCollections(a.headers)).json()) as { collections: Summary[] }
      return list.collections.find((x) => x.id === id)!.itemCount
    }

    // Pública: o chip conta 1 e a lista abre com o item.
    expect(await countOf(c)).toBe(1)
    expect(await idsOf(await getItems(c, a.headers))).toEqual([rb])

    // B torna PRIVADA → o chip cai pra 0 (gateado, bate com a lista) e a lista abre vazia;
    // a aresta collection_item PERSISTE crua (só a leitura filtra).
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, rb))
    expect(await countOf(c)).toBe(0)
    expect(await idsOf(await getItems(c, a.headers))).toEqual([])
    expect(await itemCountRaw(c)).toBe(1)

    // Volta a PÚBLICA → o chip volta a 1 e o item reaparece.
    await getDb().update(recipe).set({ visibility: 'public' }).where(eq(recipe.id, rb))
    expect(await countOf(c)).toBe(1)
    expect(await idsOf(await getItems(c, a.headers))).toEqual([rb])
  })
})

// ── Membership do picker (C10) ────────────────────────────────────────────────────
describe('Membership do detalhe', () => {
  it('saved + contains por coleção; 200 para qualquer uuid; só do próprio user', async () => {
    const a = await session()
    const b = await session()
    const r = await seedCatalog()
    await save(r, a.headers)
    const c1 = await seedCollection({ userId: a.userId, name: 'Aa' })
    await seedCollection({ userId: a.userId, name: 'Bb' })
    await addItem(c1, r, a.headers)
    // B tem uma coleção que NÃO deve aparecer para A.
    await seedCollection({ userId: b.userId, name: 'DeB' })

    const res = await getMembership(r, a.headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      saved: boolean
      collections: { id: string; name: string; contains: boolean }[]
    }
    expect(body.saved).toBe(true)
    // Só as 2 coleções de A, ordenadas por nome; contains reflete a aresta.
    expect(body.collections.map((x) => [x.name, x.contains])).toEqual([
      ['Aa', true],
      ['Bb', false],
    ])
  })

  it('receita não salva ⇒ saved:false mas ainda lista as coleções do user (pra adicionar)', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalog()
    await seedCollection({ userId, name: 'Pasta' })
    const body = (await (await getMembership(r, headers)).json()) as {
      saved: boolean
      collections: unknown[]
    }
    expect(body.saved).toBe(false)
    expect(body.collections).toHaveLength(1)
  })
})

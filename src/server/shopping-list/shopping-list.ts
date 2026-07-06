import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { shoppingList, shoppingListItem } from '@/db/schema'
import {
  DEFAULT_SHOPPING_LIST_NAME,
  MAX_SHOPPING_LISTS_PER_USER,
  validateShoppingListName,
} from '@/domain/shopping-list'
import { pgCode } from '@/server/recipe/visibility'

/**
 * Núcleo com efeito da Lista de compras — CONTAINER (issue #525, ADR-0032 dec.1). Espelha o
 * estilo de `@/server/recipe/collections` (mesma disciplina de discriminated unions + `db:
 * Database` por parâmetro): cada Lista é uma pasta PRIVADA nomeada de UM usuário, `UNIQUE(user_id,
 * name)`. Esta fatia (A1) só cobre o CRUD do container + a lista-padrão; adicionar-de-receita e a
 * agregação por `shopping_list_item` são a fatia A2.
 *
 * PRIVACIDADE (inegociável, ADR-0032 invariantes): NENHUMA leitura é anônima. Toda função escopa
 * por `shopping_list.user_id = userId`; "não é sua" e "não existe" colapsam no MESMO `not_found`
 * (404 leak-safe, como `collections.ts`). Sem toggle público no v1.
 */

// ── Tipos de retorno (discriminated unions mapeadas a HTTP pelas rotas) ──────────

export type ShoppingListSummary = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  itemCount: number
}

export type ShoppingListCreateResult =
  | { kind: 'ok'; list: { id: string; name: string; createdAt: string } }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'limit_reached' }

export type ShoppingListRenameResult =
  | { kind: 'ok' }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_found' }

export type ShoppingListDeleteResult = { kind: 'ok' } | { kind: 'not_found' }

// ── CRUD de Lista ────────────────────────────────────────────────────────────────

/**
 * Cria uma Lista de compras. Valida o nome (invalid_name); impõe o cap por usuário
 * (limit_reached); o INSERT com `onConflictDoNothing` no alvo (user_id, name) devolve vazio ⇒
 * duplicate_name (idempotente contra corrida — a UNIQUE é a rede final). Espelha
 * `applyCollectionCreate` byte-a-byte.
 */
export async function applyShoppingListCreate(input: {
  db: Database
  userId: string
  name: string
}): Promise<ShoppingListCreateResult> {
  const { db, userId, name } = input

  const v = validateShoppingListName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  // Cap por usuário (anti-abuso barato): conta antes de inserir. Corrida no limite é aceitável
  // (o cap é folgado; não há invariante crítica), e a UNIQUE cobre a de nome.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shoppingList)
    .where(eq(shoppingList.userId, userId))
  if (n >= MAX_SHOPPING_LISTS_PER_USER) return { kind: 'limit_reached' }

  const [row] = await db
    .insert(shoppingList)
    .values({ userId, name: v.name })
    .onConflictDoNothing({ target: [shoppingList.userId, shoppingList.name] })
    .returning({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
  if (!row) return { kind: 'duplicate_name' }

  return {
    kind: 'ok',
    list: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() },
  }
}

/**
 * Renomeia uma Lista do próprio usuário (inclusive a lista-padrão — nada a impede de ser
 * renomeada). Valida o nome antes; UPDATE escopado por (id, user_id) — vazio ⇒ not_found
 * (leak-safe: não é sua / não existe). Duplicado colide na UNIQUE (23505) ⇒ duplicate_name
 * (`onConflictDoNothing` não vale em UPDATE — daí o try/catch, espelha `applyCollectionRename`).
 */
export async function applyShoppingListRename(input: {
  db: Database
  userId: string
  listId: string
  name: string
}): Promise<ShoppingListRenameResult> {
  const { db, userId, listId, name } = input

  const v = validateShoppingListName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  try {
    const [row] = await db
      .update(shoppingList)
      .set({ name: v.name, updatedAt: new Date() })
      .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
      .returning({ id: shoppingList.id })
    if (!row) return { kind: 'not_found' }
    return { kind: 'ok' }
  } catch (e) {
    if (pgCode(e) === '23505') return { kind: 'duplicate_name' }
    throw e
  }
}

/**
 * Apaga uma Lista do próprio usuário. DELETE escopado por (id, user_id) — vazio ⇒ not_found. A
 * FK ON DELETE cascade apaga os `shopping_list_item` (sem órfãos). Apagar a lista-padrão é
 * permitido — `ensureDefaultShoppingList` recria no próximo uso (idempotente).
 */
export async function applyShoppingListDelete(input: {
  db: Database
  userId: string
  listId: string
}): Promise<ShoppingListDeleteResult> {
  const { db, userId, listId } = input

  const [row] = await db
    .delete(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
    .returning({ id: shoppingList.id })
  if (!row) return { kind: 'not_found' }
  return { kind: 'ok' }
}

/**
 * Garante que o usuário tem a lista-PADRÃO ("Lista de compras", ADR-0032 dec.1) — cria no 1º uso,
 * IDEMPOTENTE (não duplica sob corrida): `onConflictDoNothing` no alvo (user_id, name); se vazio
 * (já existia), busca a existente. Chamada pelo 1º "adicionar" (fatia A2) e por qualquer fluxo que
 * precise de "a lista padrão do usuário" sem exigir que ele tenha criado uma antes.
 */
export async function ensureDefaultShoppingList(input: {
  db: Database
  userId: string
}): Promise<{ id: string; name: string; createdAt: string }> {
  const { db, userId } = input

  const [inserted] = await db
    .insert(shoppingList)
    .values({ userId, name: DEFAULT_SHOPPING_LIST_NAME })
    .onConflictDoNothing({ target: [shoppingList.userId, shoppingList.name] })
    .returning({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
  if (inserted) {
    return { id: inserted.id, name: inserted.name, createdAt: inserted.createdAt.toISOString() }
  }

  // Corrida perdida ou já existia: a linha JÁ está lá (a UNIQUE garante que existe exatamente 1).
  const [existing] = await db
    .select({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
    .from(shoppingList)
    .where(and(eq(shoppingList.userId, userId), eq(shoppingList.name, DEFAULT_SHOPPING_LIST_NAME)))
  if (!existing) {
    // Não deveria ocorrer (a UNIQUE só bloqueou o INSERT porque a linha existe); erro honesto.
    throw new Error('ensureDefaultShoppingList: linha esperada não encontrada após conflito')
  }
  return { id: existing.id, name: existing.name, createdAt: existing.createdAt.toISOString() }
}

// ── Leitores ─────────────────────────────────────────────────────────────────────

/**
 * Lista as Listas de compras do usuário com a contagem de itens. LEFT JOIN + COUNT(item.id) (a
 * lista vazia dá 1 linha all-NULL e `count(*)` daria 1 errado; `count(item.id)` conta NULLs como
 * 0 — espelha `loadCollections`). Ordena por nome. `itemCount` é sempre 0 nesta fatia (A1 não
 * escreve em `shopping_list_item`), mas a projeção já entra pronta pra A2.
 */
export async function loadShoppingLists(input: {
  db: Database
  userId: string
}): Promise<ShoppingListSummary[]> {
  const { db, userId } = input
  const rows = await db
    .select({
      id: shoppingList.id,
      name: shoppingList.name,
      createdAt: shoppingList.createdAt,
      updatedAt: shoppingList.updatedAt,
      itemCount: sql<number>`count(${shoppingListItem.id})::int`,
    })
    .from(shoppingList)
    .leftJoin(shoppingListItem, eq(shoppingListItem.listId, shoppingList.id))
    .where(eq(shoppingList.userId, userId))
    .groupBy(shoppingList.id)
    .orderBy(asc(shoppingList.name))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    itemCount: r.itemCount,
  }))
}

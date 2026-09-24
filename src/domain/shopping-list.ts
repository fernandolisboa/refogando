/**
 * Kernel PURO da Lista de compras — container (issue #525, ADR-0032 dec.1) — sem DB, sem I/O.
 * Espelha `@/domain/collection` byte-a-byte: a Lista é uma pasta PRIVADA nomeada por usuário
 * (`UNIQUE(user_id, name)`); aqui vive só a regra do NOME + o cap por usuário + o nome da
 * lista-padrão. O efeito (CRUD, lista-padrão idempotente) mora no servidor
 * (`@/server/shopping-list/shopping-list`).
 */

/** Comprimento máximo do nome da Lista, medido POR CODE POINT (não por unidade UTF-16). */
export const SHOPPING_LIST_NAME_MAX = 60

/**
 * Teto de Listas por usuário — anti-abuso barato, espelha `MAX_COLLECTIONS_PER_USER`. Enforced
 * no servidor (contagem antes do INSERT), não no banco. Reversível.
 */
export const MAX_SHOPPING_LISTS_PER_USER = 100

/** Nome da lista-PADRÃO auto-criada no 1º uso (ADR-0032 dec.1) — 1 toque sem nomear. */
export const DEFAULT_SHOPPING_LIST_NAME = 'Lista de compras'

/**
 * Resultado da validação do nome. `ok:true` devolve o nome JÁ TRIMADO (o que se grava);
 * `ok:false` traz o motivo — o servidor mapeia ambos ('empty'/'too_long') para o MESMO 400
 * `nome_invalido`, como `validateCollectionName`.
 */
export type ShoppingListNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too_long' }

/**
 * Valida o nome cru de uma Lista de compras. Trima; vazio (após trim) ⇒ 'empty'; comprimento por
 * code point acima do cap ⇒ 'too_long'; senão devolve o nome trimado. `Array.from` conta CODE
 * POINTS (um emoji = 1), como `validateCollectionName`.
 */
export function validateShoppingListName(raw: string): ShoppingListNameResult {
  const name = raw.trim()
  if (name.length === 0) return { ok: false, reason: 'empty' }
  if (Array.from(name).length > SHOPPING_LIST_NAME_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, name }
}

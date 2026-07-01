/**
 * Kernel PURO da Coleção (issue #364) — sem DB, sem I/O. A Coleção é uma pasta PRIVADA que
 * agrupa um subconjunto dos Salvos do usuário (M:N sobre o Salvar, #362). Aqui vive só a
 * regra do NOME + os caps de tamanho; o efeito (CRUD, membership, cascade-ao-dessalvar) mora
 * no servidor (`@/server/recipe/collections`). Espelha a disciplina de trim+cap de `/api/me`
 * (nome/bio): o que conta para o cap é o conteúdo GRAVADO (já trimado), não o whitespace de borda.
 */

/** Comprimento máximo do nome da Coleção, medido POR CODE POINT (não por unidade UTF-16). */
export const COLLECTION_NAME_MAX = 60

/**
 * Teto de Coleções por usuário — anti-abuso barato (uma pessoa não precisa de milhares de pastas).
 * Enforced no servidor (contagem antes do INSERT), não no banco. Reversível.
 */
export const MAX_COLLECTIONS_PER_USER = 100

/**
 * Resultado da validação do nome. `ok:true` devolve o nome JÁ TRIMADO (o que se grava);
 * `ok:false` traz o motivo — o servidor mapeia ambos ('empty'/'too_long') para o MESMO 400
 * `nome_invalido` (erro de entrada), como `/api/me` faz com nome/bio.
 */
export type CollectionNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too_long' }

/**
 * Valida o nome cru de uma Coleção. Trima; vazio (após trim) ⇒ 'empty'; comprimento por code
 * point acima do cap ⇒ 'too_long'; senão devolve o nome trimado. `Array.from` conta CODE POINTS
 * (um emoji = 1), então um nome de 60 emojis não estoura pela contagem UTF-16 de `.length`.
 */
export function validateCollectionName(raw: string): CollectionNameResult {
  const name = raw.trim()
  if (name.length === 0) return { ok: false, reason: 'empty' }
  if (Array.from(name).length > COLLECTION_NAME_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, name }
}

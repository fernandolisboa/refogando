/**
 * Forma canônica de UUID (PURO — sem DB, sem I/O). Fonte ÚNICA: `@/server/http/params` re-exporta
 * daqui pra não existirem duas regex divergindo, e o classificador de busca (#269) a reusa. Domínio
 * pode ser importado pelo server (nunca o contrário — a regra de direção do `recipe-search-read`).
 *
 * Um `id` malformado cairia numa coluna `uuid` e faria o Postgres lançar 22P02 — por isso os
 * callers curto-circuitam (mesmo not_found / kind:'text') ANTES de tocar o banco.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `true` se `id` tem a forma de um uuid (não toca no DB). */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

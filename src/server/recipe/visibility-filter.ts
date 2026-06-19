import { or, isNull, eq, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Condição Drizzle da visibilidade-de-comunidade (issue #52) — espelha o predicado puro
 * `isCommunityVisible` (`@/domain/recipe-visibility-check`) no lado do query builder:
 * `owner_id IS NULL OR visibility = 'public'`.
 *
 * Ponto único de edição da regra de visibilidade-de-comunidade nos gates Drizzle; um novo
 * valor de visibilidade (ex.: `unlisted`) é alterado SÓ aqui (+ no predicado puro). Recebe a
 * tabela/alias (suas colunas `ownerId`/`visibility`), então serve qualquer JOIN.
 *
 * ORTOGONAL à moderação (`moderation_removed_at`, #18): o chamador combina via `and(...)` com
 * os filtros adicionais do seu gate.
 */
export function communityVisibleCondition(table: {
  ownerId: PgColumn
  visibility: PgColumn
}): SQL {
  return or(isNull(table.ownerId), eq(table.visibility, 'public')) as SQL
}

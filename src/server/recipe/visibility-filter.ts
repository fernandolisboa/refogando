import { and, or, isNull, eq, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Condição Drizzle da visibilidade-de-comunidade (issue #52) — espelha o predicado puro
 * `isCommunityVisible` (`@/domain/recipe-visibility-check`) no lado do query builder:
 * `(owner_id IS NULL AND curation_status = 'approved') OR visibility = 'public'`.
 *
 * Ponto único de edição da regra de visibilidade-de-comunidade nos gates Drizzle; um novo
 * valor de visibilidade (ex.: `unlisted`) é alterado SÓ aqui (+ no predicado puro). Recebe a
 * tabela/alias (colunas `ownerId`/`visibility`/`curationStatus`), então serve qualquer JOIN.
 *
 * #238/ADR-0026: o ramo CATÁLOGO (owner-null) ganha `AND curation_status='approved'` — um
 * rascunho não-aprovado não é comunidade-visível (ex.: cai da fila de tradução stale que usa
 * esta condição). `curationStatus` no param é OBRIGATÓRIO ⇒ o compilador acha todo caller.
 *
 * ORTOGONAL à moderação (`moderation_removed_at`, #18): o chamador combina via `and(...)` com
 * os filtros adicionais do seu gate.
 */
export function communityVisibleCondition(table: {
  ownerId: PgColumn
  visibility: PgColumn
  curationStatus: PgColumn
}): SQL {
  return or(
    and(isNull(table.ownerId), eq(table.curationStatus, 'approved')),
    eq(table.visibility, 'public'),
  ) as SQL
}

import { and, asc, eq, ilike, isNull, or, sql, type AnyColumn } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { escapeLike } from '@/server/sql/like'
import { classifyUserQuery, type UserSearchRow } from '@/domain/user-search-read'

const DEFAULT_LIMIT = 10

/**
 * Loader de busca de usuários (#269) — o SEAM reusável. Papéis (admin) e a futura busca pública de
 * Cozinheiros (#279) chamam ESTE MESMO loader; diferem SÓ por `includeEmail` (aqui) e pela projeção
 * pura escolhida na rota. O ranking e os gates (soft-delete) são IDÊNTICOS pros dois — não forkar.
 *
 * EMAIL É SENSÍVEL, gate na CAMADA DE DADOS (não na UI): quando `includeEmail=false` (1) a coluna
 * `email` NEM É SELECIONADA (não entra no SQL, não chega à linha/log) e (2) uma query com cara de
 * email (`a@b.com`) é CORTADA (retorna [] — sem fall-through pra texto, que poderia casar um
 * substring do email num nome/handle e confirmar a existência da conta).
 *
 * Ranking de força-de-match: exato (0) > prefixo (1) > substring (2); desempate determinístico por
 * nome e por id. Soft-deleted nunca aparece — `isNull(deletedAt)` em TODOS os ramos (incl. id exato).
 * Sem pg_trgm/FTS nos users: ILIKE de nome/handle faz seq scan — ok no tamanho atual; o índice
 * trigram GIN + ranking de popularidade é follow-up de ESCALA da busca pública (#279).
 */
export async function searchUsers(
  db: Database,
  opts: { q: string; includeEmail: boolean; limit?: number },
): Promise<UserSearchRow[]> {
  const parsed = classifyUserQuery(opts.q)
  if (!parsed) return []
  // Email só pra admin: corta a busca por email quando não-admin (a coluna nunca é tocada abaixo).
  if (parsed.kind === 'email' && !opts.includeEmail) return []

  const limit = opts.limit ?? DEFAULT_LIMIT
  const { term } = parsed
  const esc = escapeLike(term)
  const starts = `${esc}%`
  const contains = `%${esc}%`
  const notDeleted = isNull(users.deletedAt)

  // Projeção SQL: `email` SÓ entra quando admin (não vaza pro caminho público).
  const columns = {
    id: users.id,
    name: users.name,
    handle: users.handle,
    image: users.image,
    role: users.role,
    ...(opts.includeEmail ? { email: users.email } : {}),
  }

  // id exato: caminho direto pela PK (ainda gateando soft-delete). Sem ranking.
  if (parsed.kind === 'id') {
    const rows = await db
      .select(columns)
      .from(users)
      .where(and(notDeleted, eq(users.id, term)))
      .limit(limit)
    return rows as UserSearchRow[]
  }

  // Rank de UMA coluna: 0 exato (case-insensitive), 1 prefixo, 2 substring (o WHERE já garante
  // substring). Termo SEMPRE escapado + bindado (sem interpolação → sem injeção).
  const colRank = (col: AnyColumn) =>
    sql<number>`case when ${col} ilike ${esc} then 0 when ${col} ilike ${starts} then 1 else 2 end`

  let where
  let rank
  if (parsed.kind === 'text') {
    // Sem '@': casa nome OU handle. Parênteses certos: deletedAt AND (nome OR handle).
    where = and(notDeleted, or(ilike(users.name, contains), ilike(users.handle, contains)))
    rank = sql<number>`least(${colRank(users.name)}, ${colRank(users.handle)})`
  } else {
    // handle (sempre) ou email (só admin — já garantido pelo curto-circuito acima).
    const col = parsed.kind === 'handle' ? users.handle : users.email
    where = and(notDeleted, ilike(col, contains))
    rank = colRank(col)
  }

  const rows = await db
    .select(columns)
    .from(users)
    .where(where)
    .orderBy(asc(rank), asc(users.name), asc(users.id))
    .limit(limit)
  return rows as UserSearchRow[]
}

import { and, asc, eq, ilike, isNull, or, sql, type AnyColumn } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { escapeLike } from '@/server/sql/like'
import { classifyUserQuery, type UserSearchRow } from '@/domain/user-search-read'

const DEFAULT_LIMIT = 10

/** Teto de resultados da busca PÚBLICA de Cozinheiros (#279) — server-controlled (nunca lê ?limit=). */
export const COOK_SEARCH_LIMIT = 10

/**
 * Tamanho MÍNIMO do termo classificado pra acionar a busca pública de Cozinheiros (#279). 3 (não 2)
 * ALINHA com o índice trigram: `gin_trgm_ops` só satisfaz `ILIKE '%xx%'` a partir de um trigrama
 * COMPLETO (3 chars não-curinga) — abaixo disso seria seq scan numa rota anônima/sem-rate-limit. Também
 * corta ruído (substrings de 1–2 chars casam quase todo mundo). Os exemplos do AC ("alfredo", "pasta") ≥ 3.
 */
export const COOK_MIN_TERM_LEN = 3

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

/**
 * Busca PÚBLICA de Cozinheiros (#279) — o caminho da Descoberta. Reusa `searchUsers` (mesmo ranking
 * força-de-match, mesmo gate de soft-delete) mas restringe a superfície ao que o AC pede: SÓ nome +
 * @handle. Barra explicitamente:
 *  - `kind === 'id'`: um `q` com cara de UUID faria `searchUsers` resolver a PK → vazaria um oráculo
 *    anônimo `uuid interno → {nome, @handle, avatar}` (o owner_id que o resto do código nunca expõe).
 *  - `kind === 'email'`: PII — `includeEmail=false` já corta no loader; barrar aqui é cinto-e-suspensório.
 *  - `term.length < COOK_MIN_TERM_LEN` (3): ruído + abaixo do trigrama (seq scan). Mede o termo
 *    CLASSIFICADO (pós-`@`), não o `q` cru — senão `@ab` (3 chars) passaria com term 'ab' de 2 chars.
 * `includeEmail=false` é FIXO (a coluna email nem é selecionada) e o limite é SERVER-controlled
 * (`COOK_SEARCH_LIMIT`, nunca o `?limit=` do cliente — anti-DoS). Devolve linhas cruas; a rota projeta
 * pra `ProfileFollowUser` (allowlist) via `projectPublicCook`.
 */
export async function searchCooks(db: Database, q: string): Promise<UserSearchRow[]> {
  const parsed = classifyUserQuery(q)
  if (!parsed || parsed.kind === 'id' || parsed.kind === 'email' || parsed.term.length < COOK_MIN_TERM_LEN) {
    return []
  }
  return searchUsers(db, { q, includeEmail: false, limit: COOK_SEARCH_LIMIT })
}

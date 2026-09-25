import { and, asc, eq, ilike, isNull, or, sql, type AnyColumn } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { escapeLike } from '@/server/sql/like'
import { classifyUserQuery, type UserSearchRow } from '@/domain/user-search-read'
import { eligiblePublicRecipeSqlFragment } from '@/server/recipe/visibility-sql'
import { encodeSearchCursor, type SearchCursor } from '@/domain/cooks-cursor'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'
import { emailVerificationRequired } from '@/lib/auth'
import { publicAccountSql } from '@/server/auth/pending-account'

/** Uma página da busca de Cozinheiros (#308): os cooks (já allowlisted) + o cursor da PRÓXIMA página. */
export type CookSearchPage = { cooks: ProfileFollowUser[]; nextCursor: string | null }

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
 * Busca PÚBLICA de Cozinheiros (#279 cluster + #308 Descoberta dedicada). NÃO reusa `searchUsers` (que
 * fica PURO p/ o admin #269): #308 exige filtro de Cozinha + paginação keyset, que pedem CTE + EXISTS —
 * então tem query PRÓPRIA, mas com o MESMO ranking força-de-match (exato>prefixo>substring) e gate de
 * soft-delete. Barra `id` (vazaria o oráculo uuid→perfil), `email` (PII) e termo < `COOK_MIN_TERM_LEN`.
 * #470: com a confirmação de email ligada, conta PENDENTE (handle de espera, ainda não provada) fica de fora
 * (buscar pelo nome escolhido no cadastro diria se o email já tinha conta).
 *
 * **Allowlist (#269/Modelo B):** seleciona SÓ `name/handle/image` — `id`/`role`/`email` NEM entram no
 * SQL. O cursor é `(rank, name, handle)` — tiebreak no `handle` PÚBLICO (page 1 incluída, pra page1↔page2
 * não desalinharem), NUNCA no id. Limite SERVER-controlled (`COOK_SEARCH_LIMIT`, nunca o `?limit=`).
 *
 * **Filtro de Cozinha (#308):** `EXISTS (receita pública elegível na cozinha)`, anexado SÓ quando há
 * cozinha — sem cozinha, o cluster #279 segue IDÊNTICO (casa qualquer usuário por nome/@handle, sem
 * exigir receita). Com cozinha, exige ≥1 receita elegível na(s) cozinha(s) (OR-dentro-do-eixo).
 */
export async function searchCooks(
  db: Database,
  opts: { q: string; cozinhas?: string[]; cursor?: SearchCursor | null; limit?: number },
): Promise<CookSearchPage> {
  const parsed = classifyUserQuery(opts.q)
  if (!parsed || parsed.kind === 'id' || parsed.kind === 'email' || parsed.term.length < COOK_MIN_TERM_LEN) {
    return { cooks: [], nextCursor: null }
  }
  const cozinhas = opts.cozinhas ?? []
  const cursor = opts.cursor ?? null
  const limit = opts.limit ?? COOK_SEARCH_LIMIT
  const esc = escapeLike(parsed.term)
  const starts = `${esc}%`
  const contains = `%${esc}%`

  // Mesmo ranking de `searchUsers`: 0 exato (case-insensitive), 1 prefixo, 2 substring. `handle`-kind
  // ranqueia só o handle; `text`-kind o MENOR entre nome e handle. Termo SEMPRE escapado + bindado.
  const rankSql =
    parsed.kind === 'handle'
      ? sql`case when users.handle ilike ${esc} then 0 when users.handle ilike ${starts} then 1 else 2 end`
      : sql`least(
          case when users.name ilike ${esc} then 0 when users.name ilike ${starts} then 1 else 2 end,
          case when users.handle ilike ${esc} then 0 when users.handle ilike ${starts} then 1 else 2 end
        )`
  const matchSql =
    parsed.kind === 'handle'
      ? sql`users.handle ilike ${contains}`
      : sql`(users.name ilike ${contains} OR users.handle ilike ${contains})`
  // Cozinha SÓ quando pedida ⇒ cluster #279 (sem cozinha) intacto (não exige receita).
  const cozinhaExistsSql = cozinhas.length
    ? sql`AND EXISTS (
        SELECT 1 FROM recipe r
        WHERE r.owner_id = users.id AND ${eligiblePublicRecipeSqlFragment('r')}
          AND r.cozinha = ANY (${sql.param(cozinhas)}::text[])
      )`
    : sql``
  // Keyset all-ASC (rank,name,handle): próxima página = tupla lexicograficamente MAIOR. CTE expõe o
  // `rank` (CASE não pode ir no WHERE direto). `name` livre é bindado como param (injection-safe).
  const keysetSql = cursor
    ? sql`(matched.rank, matched.name, matched.handle) > (${cursor.rank}, ${cursor.name}, ${cursor.handle})`
    : sql`TRUE`

  type Row = { name: string; handle: string; image: string | null; rank: number }
  const rows = await db.execute<Row>(sql`
    WITH matched AS (
      SELECT
        users.name AS name,
        users.handle AS handle,
        users.image AS image,
        (${rankSql})::int AS rank
      FROM users
      WHERE ${publicAccountSql(emailVerificationRequired())} AND ${matchSql}
        ${cozinhaExistsSql}
    )
    SELECT matched.name AS name, matched.handle AS handle, matched.image AS image, matched.rank AS rank
    FROM matched
    WHERE ${keysetSql}
    ORDER BY matched.rank ASC, matched.name ASC, matched.handle ASC
    LIMIT ${limit + 1}
  `)

  const hasMore = rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  const last = kept[kept.length - 1]
  const nextCursor =
    hasMore && last ? encodeSearchCursor({ rank: last.rank, name: last.name, handle: last.handle }) : null
  return {
    cooks: kept.map((r) => ({ name: r.name, handle: r.handle, image: r.image })),
    nextCursor,
  }
}

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { session, users } from '@/db/schema'
import { escapeLike } from '@/server/sql/like'
import { classifyUserQuery } from '@/domain/user-search-read'
import { PENDING_SIGNUP_MAX_AGE_MS } from '@/server/auth/pending-signup-purge'
import {
  ADMIN_USER_PAGE_SIZE,
  ADMIN_USER_PRESETS,
  NEW_USER_WINDOW_DAYS,
  deriveAdminUserStatus,
  type AdminUserListPage,
  type AdminUserListQuery,
  type AdminUserPreset,
} from '@/domain/admin-user-list'

/**
 * Loader da lista de Usuários do Console (admin-only; a rota `GET /api/admin/users` aplica `requireRole
 * 'admin'`). Cada atalho é um WHERE FIXO daqui (o cliente só escolhe a chave do enum). A busca reusa o
 * `classifyUserQuery` da busca de Papéis (#269): UUID ⇒ id exato, `@x` ⇒ handle, `a@b` ⇒ email, texto ⇒ nome
 * OU handle (os dois têm índice trigram; email entra só quando o termo tem `@`, como no `searchUsers`). Termo
 * sempre escapado e bindado.
 *
 * Escala: `users` tem centenas de linhas; as contagens da tira são UMA varredura com `count(*) FILTER`, e as
 * colunas derivadas (última sessão, receitas) são subconsultas por linha da PÁGINA (25), servidas por
 * `session_user_id_idx` e `recipe_owner_id_idx`. Só a ordenação "último acesso" calcula a subconsulta para
 * todas as linhas filtradas — aceitável neste tamanho; se `users` crescer muito, vira coluna `last_seen_at`.
 */

function presetWhere(preset: AdminUserPreset): SQL {
  const notDeleted = isNull(users.deletedAt)
  switch (preset) {
    case 'todos':
      return notDeleted
    case 'novos':
      return and(
        notDeleted,
        sql`${users.createdAt} >= now() - make_interval(days => ${NEW_USER_WINDOW_DAYS})`,
      )!
    case 'sem-papel':
      return and(notDeleted, eq(users.role, 'usuario'))!
    case 'equipe':
      return and(notDeleted, inArray(users.role, ['curador', 'admin']))!
    case 'pendentes':
      return and(notDeleted, isNotNull(users.pendingSignupAt))!
    case 'pro':
      return and(notDeleted, eq(users.plan, 'pro'))!
    case 'desativadas':
      return isNotNull(users.deletedAt)
  }
}

function searchWhere(q: string): SQL | undefined {
  const parsed = classifyUserQuery(q)
  if (!parsed) return undefined
  if (parsed.kind === 'id') return eq(users.id, parsed.term)
  const contains = `%${escapeLike(parsed.term)}%`
  if (parsed.kind === 'handle') return ilike(users.handle, contains)
  if (parsed.kind === 'email') return ilike(users.email, contains)
  return or(ilike(users.name, contains), ilike(users.handle, contains))
}

// `users.id` LITERAL (não `${users.id}`): numa select de tabela única o Drizzle renderiza a coluna sem o
// prefixo da tabela (`"id"`), e dentro da subconsulta isso resolveria para o `id` da tabela INTERNA.
const lastSeenSql = sql`(select max(s.updated_at) from session s where s.user_id = users.id)`

export async function listAdminUsers(db: Database, query: AdminUserListQuery): Promise<AdminUserListPage> {
  const where = and(presetWhere(query.preset), searchWhere(query.q))

  const order =
    query.sort === 'antigos'
      ? [asc(users.createdAt), asc(users.id)]
      : query.sort === 'nome'
        ? [asc(users.name), asc(users.id)]
        : query.sort === 'acesso'
          ? [sql`${lastSeenSql} desc nulls last`, desc(users.createdAt), desc(users.id)]
          : [desc(users.createdAt), desc(users.id)]

  const countColumns = Object.fromEntries(
    ADMIN_USER_PRESETS.map((p) => [p, sql<number>`(count(*) filter (where ${presetWhere(p)}))::int`]),
  ) as Record<AdminUserPreset, SQL<number>>

  const [rows, [totalRow], [countsRow]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        handle: users.handle,
        email: users.email,
        image: users.image,
        role: users.role,
        plan: users.plan,
        emailVerified: users.emailVerified,
        locale: users.locale,
        createdAt: users.createdAt,
        pendingSignupAt: users.pendingSignupAt,
        deletedAt: users.deletedAt,
        anonymizedAt: users.anonymizedAt,
        imageGenBlockedAt: users.imageGenBlockedAt,
        lastSeenAt: lastSeenSql.mapWith(session.updatedAt),
        recipeCount: sql<number>`(select count(*)::int from recipe r where r.owner_id = users.id)`,
        publicRecipeCount: sql<number>`(select count(*)::int from recipe r where r.owner_id = users.id and r.visibility = 'public')`,
      })
      .from(users)
      .where(where)
      .orderBy(...order)
      .limit(ADMIN_USER_PAGE_SIZE)
      .offset((query.page - 1) * ADMIN_USER_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
    db.select(countColumns).from(users),
  ])

  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return {
    users: rows.map((r) => ({
      id: r.id,
      name: r.name,
      handle: r.handle,
      email: r.email,
      image: r.image,
      role: r.role,
      plan: r.plan,
      status: deriveAdminUserStatus(r),
      locale: r.locale,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: iso(r.lastSeenAt as Date | null),
      pendingPurgeAt: r.pendingSignupAt
        ? new Date(r.pendingSignupAt.getTime() + PENDING_SIGNUP_MAX_AGE_MS).toISOString()
        : null,
      deletedAt: iso(r.deletedAt),
      imageGenBlocked: r.imageGenBlockedAt != null,
      recipeCount: Number(r.recipeCount),
      publicRecipeCount: Number(r.publicRecipeCount),
    })),
    total: Number(totalRow?.n ?? 0),
    page: query.page,
    pageSize: ADMIN_USER_PAGE_SIZE,
    counts: Object.fromEntries(
      ADMIN_USER_PRESETS.map((p) => [p, Number(countsRow?.[p] ?? 0)]),
    ) as Record<AdminUserPreset, number>,
  }
}

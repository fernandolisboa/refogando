import { eq } from 'drizzle-orm'
import type { TestHelpers } from 'better-auth/plugins'
import { getAuth } from '@/lib/auth'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import type { Role } from '@/domain/user'

/**
 * Fábricas de seed de Usuário + sessão (issue #5). Mesma forma de `recipes.ts`:
 * `seedUser` insere a linha direta via getDb() (defaults seguros para teste) e devolve
 * o uuid RETORNADO. `seedSessionHeaders` minta uma sessão real pela MESMA instância
 * getAuth() (E1+E2) usando o plugin testUtils — ligado só em NODE_ENV==='test' — e
 * devolve headers prontos para passar ao route handler.
 *
 * O plano spread-a o testUtils condicionalmente em `plugins`, o que faz o TS parar de
 * inferir `ctx.test` (documentado pela lib). Acessamos via cast para TestHelpers — o
 * runtime garante a presença porque o harness roda em NODE_ENV==='test'.
 */

/**
 * Handle único e válido por seed (#128): `users.handle` é NOT NULL UNIQUE, e `seedUser`
 * insere a linha DIRETO (sem o auth hook que gera o handle em produção). Derivamos um slug
 * estável do email + sufixo aleatório curto, garantindo formato ([a-z0-9-], 3–30) e unicidade
 * entre seeds. O caller pode sobrescrever via `handle` quando o teste precisa de um valor fixo.
 */
function defaultHandle(email: string): string {
  const local = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)
  const base = local.length >= 2 ? local : 'u'
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

/** Cria um Usuário e devolve o uuid. Defaults seguros para teste. */
export async function seedUser(input: {
  email: string
  name?: string
  handle?: string
  role?: Role
  locale?: string | null
  emailVerified?: boolean
  deletedAt?: Date | null
}): Promise<string> {
  const [row] = await getDb()
    .insert(users)
    .values({
      email: input.email,
      name: input.name ?? input.email,
      handle: input.handle ?? defaultHandle(input.email),
      role: input.role ?? 'usuario',
      locale: input.locale ?? null,
      emailVerified: input.emailVerified ?? true,
      deletedAt: input.deletedAt ?? null,
    })
    .returning({ id: users.id })
  return row.id
}

/** Recupera os helpers de teste (testUtils) da instância única getAuth(). */
async function testCtx(): Promise<TestHelpers> {
  const ctx = await getAuth().$context
  const test = (ctx as { test?: TestHelpers }).test
  if (!test) {
    throw new Error('testUtils indisponível: rode com NODE_ENV=test (plugin só liga em teste).')
  }
  return test
}

/** Cria/loga um user de teste e devolve headers com o cookie de sessão. */
export async function seedSessionHeaders(input: {
  email: string
  role?: Role
  locale?: string | null
  deletedAt?: Date | null
}): Promise<{ userId: string; headers: Headers }> {
  const t = await testCtx()
  // testUtils.createUser minta um id próprio NÃO-uuid (base62) e o saveUser o insere
  // verbatim — que estoura 22P02 na coluna uuid (generateId:false não cobre este caminho
  // in-memory). Fornecemos um uuid explícito (casa com users.id uuid e com a sessão).
  const user = t.createUser({
    id: crypto.randomUUID(),
    email: input.email,
    name: input.email,
    role: input.role ?? 'usuario',
    locale: input.locale ?? null,
  })
  await t.saveUser(user)
  const { headers } = await t.login({ userId: user.id })
  // E5 — soft-delete sem seam: muta a coluna DEPOIS do login (a sessão é válida, mas o
  // gating barra deletedAt != null com 401 conta_desativada).
  if (input.deletedAt) {
    await getDb().update(users).set({ deletedAt: input.deletedAt }).where(eq(users.id, user.id))
  }
  return { userId: user.id, headers }
}

/** Atalho: minta uma sessão de conta soft-deletada (deletedAt = agora). */
export async function seedDeletedSessionHeaders(input: {
  email: string
  role?: Role
  locale?: string | null
}): Promise<{ userId: string; headers: Headers }> {
  return seedSessionHeaders({ ...input, deletedAt: new Date() })
}

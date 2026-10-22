import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET } from '@/app/api/admin/users/route'
import { getDb } from '@/server/deps'
import { session, users } from '@/db/schema'
import { seedRecipe } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { ADMIN_USER_PRESETS, type AdminUserListPage } from '@/domain/admin-user-list'

/**
 * Lista de Usuários do Console — GET /api/admin/users (admin-only). Prova: gate (anon 401, usuário e
 * curador 403); cada atalho filtra o que promete; busca por nome/@handle/email/ID; colunas derivadas
 * (receitas, última sessão, situação); allowlist da resposta (sem campos crus); paginação e `no-store`.
 *
 * O banco é COMPARTILHADO entre os arquivos de teste: toda asserção de conteúdo é escopada por um
 * prefixo único (`q`), e as contagens globais só são checadas por forma.
 */

const TAG = `lst${Math.random().toString(36).slice(2, 8)}`
/** Sufixo das contas de sessão (admin/usuário/curador): fora do `q` das asserções. */
const SES = `ses${Math.random().toString(36).slice(2, 8)}`

function get(params: Record<string, string>, headers?: Headers): Promise<Response> {
  const qs = new URLSearchParams(params).toString()
  return GET(new Request(`http://localhost/api/admin/users?${qs}`, { headers }))
}

async function list(params: Record<string, string>, headers: Headers): Promise<AdminUserListPage> {
  const res = await get(params, headers)
  expect(res.status).toBe(200)
  return (await res.json()) as AdminUserListPage
}

describe('GET /api/admin/users — gate admin', () => {
  it('sem sessão → 401', async () => {
    expect((await get({})).status).toBe(401)
  })
  it('Usuário e Curador → 403', async () => {
    const u = await seedSessionHeaders({ email: `u-${SES}@lista.test`, role: 'usuario' })
    const c = await seedSessionHeaders({ email: `c-${SES}@lista.test`, role: 'curador' })
    expect((await get({}, u.headers)).status).toBe(403)
    expect((await get({}, c.headers)).status).toBe(403)
  })
})

describe('GET /api/admin/users — atalhos, busca e colunas', () => {
  it('filtra por atalho, busca, deriva colunas e devolve só a allowlist', async () => {
    const admin = await seedSessionHeaders({ email: `adm-${SES}@lista.test`, role: 'admin' })
    const db = getDb()
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000)

    const ana = await seedUser({ email: `ana-${TAG}@lista.test`, name: `Ana ${TAG}`, handle: `ana-${TAG}` })
    const bia = await seedUser({ email: `bia-${TAG}@lista.test`, name: `Bia ${TAG}`, role: 'curador' })
    const caio = await seedUser({ email: `caio-${TAG}@lista.test`, name: `Caio ${TAG}`, emailVerified: false })
    const dani = await seedUser({ email: `dani-${TAG}@lista.test`, name: `Dani ${TAG}`, deletedAt: new Date() })
    await db.update(users).set({ createdAt: old, plan: 'pro' }).where(eq(users.id, bia))
    await db.update(users).set({ pendingSignupAt: new Date() }).where(eq(users.id, caio))
    await seedRecipe({ ownerId: ana, origin: 'ai_free_text', originalLocale: 'pt-BR', visibility: 'public' })
    await seedRecipe({ ownerId: ana, origin: 'ai_free_text', originalLocale: 'pt-BR', visibility: 'private' })
    const seen = new Date(Date.now() - 3600 * 1000)
    await db.insert(session).values({
      userId: ana,
      token: `tok-${TAG}`,
      expiresAt: new Date(Date.now() + 86400000),
      updatedAt: seen,
    })

    const names = (p: AdminUserListPage) => p.users.map((u) => u.name).sort()

    // todos: sem as desativadas.
    const todos = await list({ q: TAG }, admin.headers)
    expect(names(todos)).toEqual([`Ana ${TAG}`, `Bia ${TAG}`, `Caio ${TAG}`])
    expect(todos.users.map((u) => u.id)).not.toContain(dani)

    expect(names(await list({ q: TAG, preset: 'novos' }, admin.headers))).toEqual([`Ana ${TAG}`, `Caio ${TAG}`])
    expect(names(await list({ q: TAG, preset: 'sem-papel' }, admin.headers))).toEqual([`Ana ${TAG}`, `Caio ${TAG}`])
    expect(names(await list({ q: TAG, preset: 'equipe' }, admin.headers))).toEqual([`Bia ${TAG}`])
    expect(names(await list({ q: TAG, preset: 'pendentes' }, admin.headers))).toEqual([`Caio ${TAG}`])
    expect(names(await list({ q: TAG, preset: 'pro' }, admin.headers))).toEqual([`Bia ${TAG}`])
    expect(names(await list({ q: TAG, preset: 'desativadas' }, admin.headers))).toEqual([`Dani ${TAG}`])

    // Busca por @handle, email e ID exato.
    expect(names(await list({ q: `@ana-${TAG}` }, admin.headers))).toEqual([`Ana ${TAG}`])
    expect(names(await list({ q: `caio-${TAG}@lista` }, admin.headers))).toEqual([`Caio ${TAG}`])
    expect(names(await list({ q: bia }, admin.headers))).toEqual([`Bia ${TAG}`])

    // Colunas derivadas + situação.
    const byId = Object.fromEntries(todos.users.map((u) => [u.id, u]))
    expect(byId[ana]).toMatchObject({ recipeCount: 2, publicRecipeCount: 1, status: 'ativa', role: 'usuario' })
    expect(byId[ana].lastSeenAt).toBe(seen.toISOString())
    expect(byId[bia]).toMatchObject({ recipeCount: 0, status: 'ativa', role: 'curador', plan: 'pro', lastSeenAt: null })
    expect(byId[caio]).toMatchObject({ status: 'pendente' })
    const [caioRow] = await db.select({ at: users.pendingSignupAt }).from(users).where(eq(users.id, caio))
    expect(new Date(byId[caio].pendingPurgeAt!).getTime() - caioRow.at!.getTime()).toBe(48 * 3600 * 1000)

    // Ordenação.
    const antigos = await list({ q: TAG, sort: 'antigos' }, admin.headers)
    expect(antigos.users[0].name).toBe(`Bia ${TAG}`)
    const acesso = await list({ q: TAG, sort: 'acesso' }, admin.headers)
    expect(acesso.users[0].name).toBe(`Ana ${TAG}`)
    const nome = await list({ q: TAG, sort: 'nome' }, admin.headers)
    expect(nome.users.map((u) => u.name)).toEqual([`Ana ${TAG}`, `Bia ${TAG}`, `Caio ${TAG}`])

    // Allowlist: nenhuma chave crua.
    expect(Object.keys(byId[ana]).sort()).toEqual(
      [
        'id', 'name', 'handle', 'email', 'image', 'role', 'plan', 'status', 'locale',
        'createdAt', 'lastSeenAt', 'pendingPurgeAt', 'deletedAt', 'imageGenBlocked', 'recipeCount',
        'publicRecipeCount',
      ].sort(),
    )
  })

  it('contagens da tira, total, paginação e no-store', async () => {
    const admin = await seedSessionHeaders({ email: `adm2-${SES}@lista.test`, role: 'admin' })
    const res = await get({ page: '999999', preset: 'nao-existe', sort: 'x' }, admin.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as AdminUserListPage
    expect(Object.keys(body.counts).sort()).toEqual([...ADMIN_USER_PRESETS].sort())
    for (const p of ADMIN_USER_PRESETS) expect(Number.isInteger(body.counts[p])).toBe(true)
    expect(body.counts.todos).toBe(body.total) // preset inválido ⇒ todos, sem busca
    expect(body.page).toBe(400) // teto
    expect(body.users).toEqual([])
  })
})

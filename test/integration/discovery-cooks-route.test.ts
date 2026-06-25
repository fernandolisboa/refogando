import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/discovery/cooks/route'
import { getDb } from '@/server/deps'
import { follow } from '@/server/user/follow'
import { seedUser, seedSessionHeaders } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * Rota GET /api/discovery/cooks (#278, ADR-0024) contra Postgres real. SÓ-LOGADA (401 anon), `no-store`
 * per-viewer, e `viewerId` HARD-WIRED da sessão (anti-IDOR: nunca lê `?viewerId=`). Allowlist do corpo.
 */

function cooksReq(headers?: Headers, query = '') {
  return GET(new Request(`http://localhost/api/discovery/cooks${query}`, { headers: headers ?? new Headers() }))
}

/** Cozinheiro com 1 receita pública elegível. */
async function seedCook(email: string, handle: string): Promise<string> {
  const id = await seedUser({ email, handle })
  await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: id })
  return id
}

describe('GET /api/discovery/cooks (#278)', () => {
  it('anônimo → 401', async () => {
    await seedCook('a@route.test', 'rota-a')
    const res = await cooksReq()
    expect(res.status).toBe(401)
  })

  it('logado → 200 + Cache-Control no-store + cooks (exclui self e já-seguidos)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'logado@route.test' })
    // o viewer também é um Cozinheiro elegível (tem receita pública) → deve sair por ser self.
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: userId })
    const seguido = await seedCook('seg@route.test', 'rota-seguido')
    await seedCook('livre@route.test', 'rota-livre')
    await follow(getDb(), userId, seguido)

    const res = await cooksReq(headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { cooks: { handle: string }[] }
    const handles = body.cooks.map((c) => c.handle)
    expect(handles).toContain('rota-livre')
    expect(handles).not.toContain('rota-seguido') // já-seguido
    expect(handles).not.toContain((await getHandle(userId))) // self
  })

  it('IGNORA ?viewerId de outro usuário (anti-IDOR): usa SÓ a sessão', async () => {
    const { userId: u, headers } = await seedSessionHeaders({ email: 'u@route.test' })
    const { userId: v } = await seedSessionHeaders({ email: 'v@route.test' })
    const cookA = await seedCook('a2@route.test', 'rota-a2') // U segue A
    const cookB = await seedCook('b2@route.test', 'rota-b2') // V segue B
    await follow(getDb(), u, cookA)
    await follow(getDb(), v, cookB)

    // U passa ?viewerId=V. Se a rota respeitasse o param (vulnerável), excluiria B e incluiria A.
    const res = await cooksReq(headers, `?viewerId=${v}`)
    const body = (await res.json()) as { cooks: { handle: string }[] }
    const handles = body.cooks.map((c) => c.handle)
    expect(handles).toContain('rota-b2') // V segue B, mas a sessão é U → B aparece
    expect(handles).not.toContain('rota-a2') // U (a sessão) segue A → A excluído
  })

  it('cada cook do corpo é allowlist { name, handle, image, recipeCount }', async () => {
    const { headers } = await seedSessionHeaders({ email: 'dto@route.test' })
    await seedCook('c1@route.test', 'rota-c1')
    const res = await cooksReq(headers)
    const body = (await res.json()) as { cooks: Record<string, unknown>[] }
    expect(body.cooks.length).toBeGreaterThan(0)
    for (const c of body.cooks) {
      expect(Object.keys(c).sort()).toEqual(['handle', 'image', 'name', 'recipeCount'])
    }
  })
})

async function getHandle(userId: string): Promise<string> {
  const { users } = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return row!.handle
}

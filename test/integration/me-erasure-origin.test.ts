import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST } from '@/app/api/me/erasure/route'
import { getDb } from '@/server/deps'
import { session, users } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Guarda de mesma origem no `POST /api/me/erasure` (#595): defesa em profundidade contra CSRF, além do
 * cookie SameSite=Lax. Um `Sec-Fetch-Site` de outro site (ou de um subdomínio) é recusado com 403 ANTES
 * de qualquer efeito, mesmo com sessão válida e `{confirm:true}`. O conteúdo da eliminação é testado em
 * `me-erasure.test.ts`; aqui só a guarda.
 */

function post(headers: Headers, site?: string): Promise<Response> {
  const h = new Headers(headers)
  if (site !== undefined) h.set('sec-fetch-site', site)
  h.set('content-type', 'application/json')
  return POST(
    new Request('http://localhost/api/me/erasure', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ confirm: true }),
    }),
  )
}

async function state(userId: string): Promise<{ deletedAt: Date | null; sessions: number }> {
  const [u] = await getDb().select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId))
  const [s] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(session)
    .where(eq(session.userId, userId))
  return { deletedAt: u?.deletedAt ?? null, sessions: s?.n ?? 0 }
}

describe('/api/me/erasure — guarda de mesma origem (#595)', () => {
  for (const site of ['cross-site', 'same-site']) {
    it(`Sec-Fetch-Site: ${site} → 403 origem_nao_permitida, nada é eliminado`, async () => {
      const { userId, headers } = await seedSessionHeaders({ email: `${site}@erasure-origin.test` })
      const before = await state(userId)

      const res = await post(headers, site)
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
      await expect(res.json()).resolves.toEqual({ error: 'origem_nao_permitida' })

      const after = await state(userId)
      expect(after.deletedAt).toBeNull()
      expect(after.sessions).toBe(before.sessions)
      expect(after.sessions).toBeGreaterThan(0)
    })
  }

  it('Sec-Fetch-Site: same-origin (a própria interface) → 200 e a conta é eliminada', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'same-origin@erasure-origin.test' })
    const res = await post(headers, 'same-origin')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })
    expect((await state(userId)).deletedAt).not.toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as authCatchAll } from '@/app/api/auth/[...all]/route'
import { getAuth } from '@/lib/auth'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'

/**
 * Papel no signup (T9b — funde E6+E7, #5.AC1). (a) Injetar {role:'admin'} no signup NÃO
 * eleva o papel — `role` não está em `additionalFields` (input:false), então o valor do
 * cliente é ignorado e o `defaultRole:'usuario'` do plugin admin vence. (b) signUpEmail
 * SEM role grava 'usuario' — prova que o default 'user' do plugin (que NÃO existe no
 * pgEnum role) nunca vaza pro INSERT. Exercita o catch-all real (porta HTTP) em (a).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function roleOf(email: string): Promise<string | undefined> {
  const [row] = await getDb().select({ role: users.role }).from(users).where(eq(users.email, email))
  return row?.role
}

describe('signup — papel não-escalável e default', () => {
  it('E6 — injetar {role:"admin"} no POST /api/auth/sign-up/email NÃO vira admin', async () => {
    const email = 'injetor@signup.test'
    const res = await authCatchAll(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'senha-super-secreta-123',
          name: 'Injetor',
          role: 'admin', // tentativa de escalada — deve ser barrada
        }),
      }),
    )
    // Contrato real do Better Auth (parseInputData): `role` é input:false SEM defaultValue
    // no schema do campo (o default vem de `defaultRole`, mecanismo à parte). Logo, mandar
    // `role` no signup é RECUSADO com 400 FIELD_NOT_ALLOWED — a escalada não é silenciosamente
    // ignorada, é rejeitada (garantia ainda mais forte que #5.AC1: nenhuma conta é criada).
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FIELD_NOT_ALLOWED' })
    // Nenhuma linha admin (nem qualquer linha) foi persistida para esse e-mail.
    expect(await roleOf(email)).toBeUndefined()
  })

  it('E7 — signUpEmail SEM role grava role=usuario (defaultRole, não o "user" do plugin)', async () => {
    const email = 'semrole@signup.test'
    const res = await getAuth().api.signUpEmail({
      body: { email, password: 'senha-super-secreta-123', name: 'Sem Role' },
    })
    expect(res.user.id).toMatch(UUID_RE)
    expect(await roleOf(email)).toBe('usuario')
  })
})

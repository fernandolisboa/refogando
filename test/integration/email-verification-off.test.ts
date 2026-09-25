import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { POST as authPost } from '@/app/api/auth/[...all]/route'
import { getAuth, resetAuthForTests } from '@/lib/auth'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { session, users, verification } from '@/db/schema'

/**
 * Gate da confirmação de email (#470) DESLIGADO — produção sem Brevo (`canSendAccountEmail() === false`). Sem
 * canal de e-mail, exigir confirmação trancaria toda conta nova; então o cadastro se comporta EXATAMENTE como antes
 * de #470: loga direto (200 com token + cookie de sessão), nenhum e-mail, e conta não confirmada entra normalmente.
 * O preço consciente é a enumeração pelo 422, que só fecha quando o e-mail de conta é configurado.
 */

const PASSWORD = 'senha-segura-123'

let mailer: FakeMailer

beforeEach(() => {
  mailer = new FakeMailer({ accountEmailConfigured: false })
  setMailer(mailer)
  resetAuthForTests()
})

afterAll(() => resetAuthForTests())

function post(path: string, body: unknown): Promise<Response> {
  return authPost(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function userRow(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email))
  return row
}

describe('confirmação de email com o e-mail de conta NÃO configurado (#470, fail-safe)', () => {
  it('cadastro loga direto como antes: 200 com token, cookie e sessão; corpo completo; nenhum e-mail', async () => {
    const res = await post('/sign-up/email', { email: 'nova@off.test', password: PASSWORD, name: 'Ana' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/better-auth\.session_token=/)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
    // Corpo SEM o corte do hook (que só age com o gate ligado): o user completo de antes, com handle.
    expect(body.user).toMatchObject({ email: 'nova@off.test', handle: 'ana', role: 'usuario', emailVerified: false })

    const row = await userRow('nova@off.test')
    expect(await getDb().select().from(session).where(eq(session.userId, row.id))).toHaveLength(1)
    expect(mailer.accountSent).toHaveLength(0)
  })

  it('email existente ainda responde 422 (a correção da enumeração só liga com o e-mail configurado)', async () => {
    await post('/sign-up/email', { email: 'existe@off.test', password: PASSWORD, name: 'Ana' })
    const dup = await post('/sign-up/email', { email: 'existe@off.test', password: PASSWORD, name: 'Ana' })
    expect(dup.status).toBe(422)
    expect(await dup.json()).toMatchObject({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })
  })

  it('conta NÃO confirmada (legado, email_verified=false) entra normalmente, sem e-mail', async () => {
    await getAuth().api.signUpEmail({ body: { email: 'legado@off.test', password: PASSWORD, name: 'Legado' } })
    expect((await userRow('legado@off.test')).emailVerified).toBe(false)

    const res = await post('/sign-in/email', { email: 'legado@off.test', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/better-auth\.session_token=/)
    expect(mailer.accountSent).toHaveLength(0)
  })

  it('R3 — /send-verification-email como antes de #470: 400 VERIFICATION_EMAIL_NOT_ENABLED, sem marcador nem log', async () => {
    await getAuth().api.signUpEmail({ body: { email: 'reenvio@off.test', password: PASSWORD, name: 'Reenvio' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await post('/send-verification-email', { email: 'reenvio@off.test' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'VERIFICATION_EMAIL_NOT_ENABLED' })
      expect(mailer.accountSent).toHaveLength(0)
      expect(await getDb().select().from(verification).where(like(verification.identifier, '%-email-sent:%'))).toHaveLength(0)
      expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('[auth]'))).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
    const opts = getAuth().options
    expect(opts.emailVerification).toBeUndefined()
    expect(opts.emailAndPassword).not.toHaveProperty('onExistingUserSignUp')
    expect(opts.emailAndPassword).not.toHaveProperty('onPasswordReset')
    expect(opts.emailAndPassword).not.toHaveProperty('customSyntheticUser')
  })

  it('o gate é o interruptor: com o e-mail configurado (nova instância), o cadastro deixa de logar', async () => {
    setMailer(new FakeMailer())
    resetAuthForTests()
    const res = await post('/sign-up/email', { email: 'ligado@off.test', password: PASSWORD, name: 'Ana' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await res.json()).token).toBeNull()
  })
})

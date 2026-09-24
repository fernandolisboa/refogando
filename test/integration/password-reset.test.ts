import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...all]/route'
import { getAuth } from '@/lib/auth'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { session, users } from '@/db/schema'

/**
 * Esqueci minha senha (#469) — fluxo inteiro pela porta HTTP real (`/api/auth/[...all]`), com o
 * `FakeMailer` no seam. Prova: o e-mail sai (no idioma salvo) com o link do Better Auth; a resposta é a
 * MESMA para email inexistente (sem enumeração) e nenhum e-mail sai; conta soft-deletada não recebe; o
 * link redireciona com `?token=` pra nossa tela; a nova senha vale, a antiga não, o token é de uso único
 * e as sessões abertas caem.
 */

const PASSWORD = 'senha-antiga-123'
const NEW_PASSWORD = 'senha-nova-456'

let mailer: FakeMailer

beforeEach(() => {
  mailer = new FakeMailer()
  setMailer(mailer)
})

function post(path: string, body: unknown): Promise<Response> {
  return authPost(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function signUp(email: string, locale?: string) {
  const res = await getAuth().api.signUpEmail({ body: { email, password: PASSWORD, name: 'Cozinheira' } })
  if (locale) await getDb().update(users).set({ locale }).where(eq(users.email, email))
  return res.user.id
}

function requestReset(email: string) {
  return post('/request-password-reset', { email, redirectTo: '/pt-BR/reset-password' })
}

/** Extrai o link do corpo de texto do último e-mail de conta. */
function lastLink(): string {
  const text = mailer.accountSent.at(-1)!.text
  const match = text.match(/https?:\/\/\S+/)
  if (!match) throw new Error('sem link no e-mail')
  return match[0]
}

describe('esqueci minha senha (#469)', () => {
  it('conta existente: envia o e-mail no idioma salvo, com o link de reset', async () => {
    await signUp('ana@reset.test', 'en-US')
    const res = await requestReset('ana@reset.test')
    expect(res.status).toBe(200)
    expect(mailer.accountSent).toHaveLength(1)
    const mail = mailer.accountSent[0]
    expect(mail.to).toBe('ana@reset.test')
    expect(mail.subject).toBe('Reset your Refogando password')
    expect(lastLink()).toMatch(/\/api\/auth\/reset-password\/[^?]+\?callbackURL=%2Fpt-BR%2Freset-password$/)
    expect(mailer.sent).toHaveLength(0) // nada no canal do Encarregado
  })

  it('email inexistente: mesma resposta, nenhum e-mail', async () => {
    await signUp('existe@reset.test')
    const known = await (await requestReset('existe@reset.test')).json()
    const unknown = await requestReset('ninguem@reset.test')
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toEqual(known)
    expect(mailer.accountSent).toHaveLength(1) // só o da conta que existe
  })

  it('conta soft-deletada não recebe e-mail', async () => {
    await signUp('apagada@reset.test')
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.email, 'apagada@reset.test'))
    const res = await requestReset('apagada@reset.test')
    expect(res.status).toBe(200)
    expect(mailer.accountSent).toHaveLength(0)
  })

  it('link → nova senha vale, antiga não, token de uso único, sessões derrubadas', async () => {
    const userId = await signUp('bia@reset.test')
    expect(await getDb().select().from(session).where(eq(session.userId, userId))).toHaveLength(1)
    await requestReset('bia@reset.test')

    // O link do e-mail passa pela rota GET do Better Auth, que redireciona pra nossa tela com ?token=.
    const hop = await authGet(new Request(lastLink(), { redirect: 'manual' }))
    expect(hop.status).toBe(302)
    const target = new URL(hop.headers.get('location')!, 'http://localhost')
    expect(target.pathname).toBe('/pt-BR/reset-password')
    const token = target.searchParams.get('token')!
    expect(token).toBeTruthy()

    expect((await post('/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(200)
    // Uso único: o mesmo token não serve de novo.
    const reuse = await post('/reset-password', { token, newPassword: 'outra-senha-789' })
    expect(reuse.status).toBe(400)
    expect(await reuse.json()).toMatchObject({ code: 'INVALID_TOKEN' })

    expect(await getDb().select().from(session).where(eq(session.userId, userId))).toHaveLength(0)
    expect((await post('/sign-in/email', { email: 'bia@reset.test', password: PASSWORD })).status).toBe(401)
    expect((await post('/sign-in/email', { email: 'bia@reset.test', password: NEW_PASSWORD })).status).toBe(200)
  })

  it('token inválido na rota GET redireciona com ?error=INVALID_TOKEN', async () => {
    const hop = await authGet(
      new Request('http://localhost/api/auth/reset-password/nao-existe?callbackURL=%2Fpt-BR%2Freset-password', {
        redirect: 'manual',
      }),
    )
    expect(hop.status).toBe(302)
    const target = new URL(hop.headers.get('location')!, 'http://localhost')
    expect(target.pathname).toBe('/pt-BR/reset-password')
    expect(target.searchParams.get('error')).toBe('INVALID_TOKEN')
  })
})

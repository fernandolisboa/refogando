import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...all]/route'
import { getAuth } from '@/lib/auth'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { session, users } from '@/db/schema'
import { seedUser } from '../helpers/users'

/**
 * Confirmação de email no cadastro (#470) — pela porta HTTP real (`/api/auth/[...all]`), com o `FakeMailer` no
 * seam. Prova, antes de tudo, que `/sign-up/email` NÃO enumera contas: email já cadastrado responde com o MESMO
 * status, sem cookie, e um corpo de MESMA forma que um email novo (antes: 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL
 * vs 200). Depois, o fluxo: conta nasce não confirmada e sem sessão; o e-mail sai no idioma do request; login antes
 * de confirmar é 403 EMAIL_NOT_VERIFIED (e reenvia); o link confirma, loga e volta pela nossa tela `/verify-email`;
 * reenvio neutro com teto por conta; e a migração 0067 marca as contas antigas como confirmadas.
 */

const PASSWORD = 'senha-segura-123'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

let mailer: FakeMailer

beforeEach(() => {
  mailer = new FakeMailer()
  setMailer(mailer)
})

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return authPost(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

function signUp(email: string, name = 'Ana', extra: Record<string, unknown> = {}, headers?: Record<string, string>) {
  return post('/sign-up/email', { email, password: PASSWORD, name, ...extra }, headers)
}

/** Conta existente e CONFIRMADA (como as de produção depois da migração 0067), sem e-mails no mailer. */
async function existingAccount(email: string, name = 'Ana'): Promise<string> {
  const res = await getAuth().api.signUpEmail({ body: { email, password: PASSWORD, name } })
  await getDb().update(users).set({ emailVerified: true }).where(eq(users.email, email))
  mailer.accountSent.splice(0)
  return res.user.id
}

/** Troca cada valor pelo seu "tipo observável" — o que um atacante compara entre as duas respostas. */
function shape(v: unknown): unknown {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.map(shape)
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)]))
  }
  if (typeof v === 'string') return UUID_RE.test(v) ? 'uuid' : ISO_RE.test(v) ? 'iso-date' : 'string'
  return typeof v
}

/** Link do último e-mail de conta. */
function lastLink(): string {
  const match = mailer.accountSent.at(-1)!.text.match(/https?:\/\/\S+/)
  if (!match) throw new Error('sem link no e-mail')
  return match[0]
}

async function userRow(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email))
  return row
}

async function sessionsOf(userId: string) {
  return getDb().select().from(session).where(eq(session.userId, userId))
}

describe('cadastro sem enumeração de contas (#470)', () => {
  it('email existente responde igual a email novo: mesmo status, sem cookie, corpo de mesma forma', async () => {
    await existingAccount('existe@enum.test')

    const fresh = await signUp('nova@enum.test')
    const dup = await signUp('existe@enum.test')

    expect(fresh.status).toBe(200)
    expect(dup.status).toBe(fresh.status)
    expect(fresh.headers.get('set-cookie')).toBeNull()
    expect(dup.headers.get('set-cookie')).toBeNull()

    const a = await fresh.json()
    const b = await dup.json()
    expect(shape(b)).toEqual(shape(a))
    expect(Object.keys(a).sort()).toEqual(['token', 'user'])
    expect(Object.keys(a.user).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'image', 'name', 'updatedAt'],
    )
    expect(a.token).toBeNull()
    expect(b.token).toBeNull()
    expect(a.user.id).toMatch(UUID_RE)
    expect(b.user.id).toMatch(UUID_RE)
    expect(a.user).toMatchObject({ name: 'Ana', email: 'nova@enum.test', emailVerified: false, image: null })
    expect(b.user).toMatchObject({ name: 'Ana', email: 'existe@enum.test', emailVerified: false, image: null })
  })

  it('email existente (qualquer caixa): nada muda na conta, nenhum e-mail sai, a senha antiga segue valendo', async () => {
    const userId = await existingAccount('dona@enum.test')

    const res = await post('/sign-up/email', { email: 'DONA@enum.test', password: 'senha-do-invasor-9', name: 'X' })
    expect(res.status).toBe(200)

    expect(mailer.accountSent).toHaveLength(0)
    expect(await getDb().select().from(users).where(eq(users.email, 'dona@enum.test'))).toHaveLength(1)
    expect((await userRow('dona@enum.test')).name).toBe('Ana')
    expect(await sessionsOf(userId)).toHaveLength(0)
    expect((await post('/sign-in/email', { email: 'dona@enum.test', password: 'senha-do-invasor-9' })).status).toBe(401)
    expect((await post('/sign-in/email', { email: 'dona@enum.test', password: PASSWORD })).status).toBe(200)
  })

  it('erros de validação não dependem da conta (senha curta: 400 igual nos dois casos)', async () => {
    await existingAccount('curta@enum.test')
    const a = await post('/sign-up/email', { email: 'curta@enum.test', password: 'curta', name: 'Ana' })
    const b = await post('/sign-up/email', { email: 'outra@enum.test', password: 'curta', name: 'Ana' })
    expect(a.status).toBe(400)
    expect(b.status).toBe(400)
    expect(await a.json()).toEqual(await b.json())
  })
})

describe('confirmação de email (#470)', () => {
  it('email novo: conta nasce NÃO confirmada e sem sessão; o e-mail sai no idioma do request, com o destino', async () => {
    const res = await signUp('bo@verify.test', 'Bo', { callbackURL: '/u/bo' }, { cookie: 'locale=en-US' })
    expect(res.status).toBe(200)

    const row = await userRow('bo@verify.test')
    expect(row.emailVerified).toBe(false)
    expect(await sessionsOf(row.id)).toHaveLength(0)

    expect(mailer.accountSent).toHaveLength(1)
    const mail = mailer.accountSent[0]
    expect(mail.to).toBe('bo@verify.test')
    expect(mail.subject).toBe('Confirm your email for Refogando')
    const link = new URL(lastLink())
    expect(link.pathname).toBe('/api/auth/verify-email')
    expect(link.searchParams.get('callbackURL')).toBe('/en-US/verify-email?returnTo=%2Fu%2Fbo')
    expect(mailer.sent).toHaveLength(0) // nada no canal do Encarregado
  })

  it('sem cookie de locale, usa o Accept-Language; sem nada, pt-BR', async () => {
    await signUp('al@verify.test', 'Al', {}, { 'accept-language': 'en-GB,en;q=0.9' })
    expect(mailer.accountSent.at(-1)!.subject).toBe('Confirm your email for Refogando')
    await signUp('pt@verify.test', 'Pt')
    expect(mailer.accountSent.at(-1)!.subject).toBe('Confirme seu email no Refogando')
  })

  it('link usa a origem CONFIÁVEL de env, não o Host do request', async () => {
    await authPost(
      new Request('http://evil.test/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'evil.test' },
        body: JSON.stringify({ email: 'host@verify.test', password: PASSWORD, name: 'H' }),
      }),
    )
    expect(new URL(lastLink()).origin).toBe('http://localhost:3000')
  })

  it('destino externo no callbackURL não vira open-redirect: o link volta pra "/"', async () => {
    await signUp('open@verify.test', 'O', { callbackURL: '/\\evil.test' })
    expect(new URL(lastLink()).searchParams.get('callbackURL')).toBe('/pt-BR/verify-email?returnTo=%2F')
  })

  it('login antes de confirmar: 403 EMAIL_NOT_VERIFIED, sem sessão, e o link é reenviado', async () => {
    await signUp('cedo@verify.test')
    mailer.accountSent.splice(0)

    const res = await post('/sign-in/email', { email: 'cedo@verify.test', password: PASSWORD })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await sessionsOf((await userRow('cedo@verify.test')).id)).toHaveLength(0)
    expect(mailer.accountSent).toHaveLength(1)

    // Senha errada de conta não confirmada: o 401 de sempre, sem e-mail (não revela o estado da conta).
    const wrong = await post('/sign-in/email', { email: 'cedo@verify.test', password: 'errada-123456' })
    expect(wrong.status).toBe(401)
    expect(mailer.accountSent).toHaveLength(1)
  })

  it('o link confirma, LOGA e volta pela nossa tela com o destino; reabrir não loga de novo', async () => {
    await signUp('bia@verify.test', 'Bia', { callbackURL: '/u/bia' })
    const userId = (await userRow('bia@verify.test')).id

    const hop = await authGet(new Request(lastLink(), { redirect: 'manual' }))
    expect(hop.status).toBe(302)
    expect(hop.headers.get('location')).toBe('/pt-BR/verify-email?returnTo=%2Fu%2Fbia')
    expect(hop.headers.get('set-cookie')).toMatch(/better-auth\.session_token=/)
    expect((await userRow('bia@verify.test')).emailVerified).toBe(true)
    expect(await sessionsOf(userId)).toHaveLength(1)

    const again = await authGet(new Request(lastLink(), { redirect: 'manual' }))
    expect(again.status).toBe(302)
    expect(again.headers.get('set-cookie')).toBeNull()
    expect(await sessionsOf(userId)).toHaveLength(1)

    expect((await post('/sign-in/email', { email: 'bia@verify.test', password: PASSWORD })).status).toBe(200)
  })

  it('link adulterado → nossa tela com ?error (sem confirmar nada)', async () => {
    await signUp('adulterado@verify.test')
    const link = new URL(lastLink())
    link.searchParams.set('token', `${link.searchParams.get('token')}x`)
    const hop = await authGet(new Request(link.toString(), { redirect: 'manual' }))
    expect(hop.status).toBe(302)
    const target = new URL(hop.headers.get('location')!, 'http://localhost')
    expect(target.pathname).toBe('/pt-BR/verify-email')
    expect(target.searchParams.get('error')).toBe('INVALID_TOKEN')
    expect(hop.headers.get('set-cookie')).toBeNull()
    expect((await userRow('adulterado@verify.test')).emailVerified).toBe(false)
  })

  it('reenvio: MESMA resposta para conta não confirmada, confirmada e inexistente; só a não confirmada recebe', async () => {
    await signUp('pendente@verify.test')
    await existingAccount('confirmada@verify.test')
    mailer.accountSent.splice(0)

    const bodies = []
    for (const email of ['pendente@verify.test', 'confirmada@verify.test', 'ninguem@verify.test']) {
      const res = await post('/send-verification-email', { email, callbackURL: '/' })
      expect(res.status).toBe(200)
      bodies.push(await res.json())
    }
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])
    expect(mailer.accountSent.map((m) => m.to)).toEqual(['pendente@verify.test'])
  })

  it('no máx. 3 e-mails de confirmação por conta na janela (anti mail-bombing por destinatário)', async () => {
    await signUp('bomba@verify.test') // 1º
    for (let i = 0; i < 5; i++) {
      expect((await post('/send-verification-email', { email: 'bomba@verify.test' })).status).toBe(200)
    }
    expect(mailer.accountSent).toHaveLength(3)
  })

  it('conta soft-deletada não recebe e-mail de confirmação', async () => {
    await signUp('apagada@verify.test')
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.email, 'apagada@verify.test'))
    mailer.accountSent.splice(0)
    expect((await post('/send-verification-email', { email: 'apagada@verify.test' })).status).toBe(200)
    expect(mailer.accountSent).toHaveLength(0)
  })
})

describe('migração 0067 — contas anteriores à confirmação não ficam trancadas (#470)', () => {
  const migration = readFileSync(new URL('../../drizzle/0067_verify_existing_users.sql', import.meta.url), 'utf8')

  it('marca todas as contas como confirmadas e é idempotente', async () => {
    await seedUser({ email: 'antiga1@mig.test', emailVerified: false })
    await seedUser({ email: 'antiga2@mig.test', emailVerified: false, deletedAt: new Date() })
    await seedUser({ email: 'ja@mig.test', emailVerified: true })

    await getDb().execute(sql.raw(migration))
    await getDb().execute(sql.raw(migration)) // re-rodar é no-op

    const rows = await getDb().select({ v: users.emailVerified }).from(users)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.v)).toBe(true)
  })

  it('conta antiga (email+senha, nunca confirmada) volta a entrar depois da migração', async () => {
    await getAuth().api.signUpEmail({ body: { email: 'legado@mig.test', password: PASSWORD, name: 'Legado' } })
    expect((await post('/sign-in/email', { email: 'legado@mig.test', password: PASSWORD })).status).toBe(403)
    await getDb().execute(sql.raw(migration))
    expect((await post('/sign-in/email', { email: 'legado@mig.test', password: PASSWORD })).status).toBe(200)
  })
})

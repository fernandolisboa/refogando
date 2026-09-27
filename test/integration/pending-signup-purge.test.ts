import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...all]/route'
import { GET as cronGet } from '@/app/api/cron/account-purge/route'
import { getAuth, resetAuthForTests } from '@/lib/auth'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import {
  CONTENT_GUARDS,
  PENDING_SIGNUP_MAX_AGE_MS,
  PURGED_SIGNUP_MEMORY_MS,
  purgeStalePendingSignups,
  wasPendingSignupPurged,
} from '@/server/auth/pending-signup-purge'
import * as schema from '@/db/schema'
import { account, recipeSave, session, userFollow, users, verification } from '@/db/schema'
import { seedUser } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'

/**
 * Expurgo de cadastros abandonados (#470 follow-up, ADR-0014) — pela porta HTTP real do auth, com o `FakeMailer`.
 * Duas frentes:
 *  - o MARCADOR `users.pending_signup_at`: nasce só no cadastro de email+senha com a confirmação ligada e sai
 *    quando alguém prova o email (link de confirmação, "conclua seu cadastro", admin) ou entra na conta;
 *  - `purgeStalePendingSignups`: apaga só conta marcada há mais de 48h e ainda não confirmada, sem sessão, sem
 *    conta de provedor, sem link de senha válido e sem conteúdo — e nunca por handle `pendente-` sem marcador;
 *  - a LÁPIDE do email expurgado: o próximo cadastro dele manda o link de senha, não o de confirmação.
 */

const PASSWORD = 'senha-segura-123'
const HOUR = 60 * 60 * 1000

let mailer: FakeMailer

beforeEach(() => {
  mailer = new FakeMailer()
  setMailer(mailer)
  resetAuthForTests()
})

afterAll(() => resetAuthForTests())

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return authPost(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

function lastLink(): string {
  const match = mailer.accountSent.at(-1)!.text.match(/https?:\/\/\S+/)
  if (!match) throw new Error('sem link no e-mail')
  return match[0]
}

async function userRow(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email))
  return row
}

/** Cadastro de email+senha com a confirmação ligada ⇒ conta pendente (marcada). Devolve o id. */
async function pendingSignup(email: string, name = 'Ana'): Promise<string> {
  const res = await post('/sign-up/email', { email, password: PASSWORD, name })
  expect(res.status).toBe(200)
  return (await userRow(email)).id
}

/** Envelhece o marcador (simula um cadastro feito `hours` atrás). */
async function ageMarker(userId: string, hours: number): Promise<void> {
  await getDb()
    .update(users)
    .set({ pendingSignupAt: new Date(Date.now() - hours * HOUR) })
    .where(eq(users.id, userId))
}

/** Vence os links de senha já emitidos (simula que o "conclua seu cadastro" pedido passou da 1h). */
async function expireResetLinks(): Promise<void> {
  await getDb()
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - HOUR) })
    .where(like(verification.identifier, 'reset-password:%'))
}

describe('marcador de cadastro pendente', () => {
  it('nasce no cadastro de email+senha com a confirmação ligada, e não sai na resposta nem na sessão', async () => {
    const before = Date.now()
    const res = await post('/sign-up/email', { email: 'ana@pending.test', password: PASSWORD, name: 'Ana' })
    const row = await userRow('ana@pending.test')
    expect(row.emailVerified).toBe(false)
    expect(row.pendingSignupAt).toBeInstanceOf(Date)
    expect(row.pendingSignupAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(JSON.stringify(await res.json())).not.toMatch(/pendingSignup/)

    // Confirmado pelo link, a sessão que nasce não carrega o campo (returned: false).
    const hop = await authGet(new Request(lastLink(), { redirect: 'manual' }))
    const cookie = hop.headers.get('set-cookie')!.split(';')[0]
    const current = await getAuth().api.getSession({ headers: new Headers({ cookie }) })
    expect(current?.user.email).toBe('ana@pending.test')
    expect(current?.user).not.toHaveProperty('pendingSignupAt')
  })

  it('só o cadastro de email+senha marca: Google, admin e scripts não', async () => {
    const before = getAuth().options.databaseHooks!.user!.create!.before!
    const data = { name: 'Clotilde', email: 'x@pending.test', emailVerified: false } as never
    const markerFor = async (path: string | null) => {
      const out = (await before(data, (path ? { path } : null) as never)) as { data: { pendingSignupAt?: Date } }
      return out.data.pendingSignupAt
    }
    expect(await markerFor('/sign-up/email')).toBeInstanceOf(Date)
    for (const path of ['/callback/:id', '/sign-in/social', '/admin/create-user', null]) {
      expect(await markerFor(path)).toBeUndefined()
    }
  })

  it('com a confirmação desligada, o cadastro não marca nada', async () => {
    setMailer(new FakeMailer({ accountEmailConfigured: false }))
    resetAuthForTests()
    await post('/sign-up/email', { email: 'off@pending.test', password: PASSWORD, name: 'Off' })
    expect((await userRow('off@pending.test')).pendingSignupAt).toBeNull()
  })

  it('o hook de update põe a limpeza do marcador no MESMO UPDATE que confirma o email (e só nele)', async () => {
    const before = getAuth().options.databaseHooks!.user!.update!.before!
    const run = async (data: Record<string, unknown>) =>
      ((await before(data as never)) as { data: Record<string, unknown> } | undefined)?.data
    expect(await run({ emailVerified: true })).toEqual({ emailVerified: true, pendingSignupAt: null })
    expect(await run({ name: 'Outro' })).toBeUndefined()
    expect(await run({ emailVerified: false })).toBeUndefined()
  })

  it('o link de confirmação limpa o marcador', async () => {
    await pendingSignup('bia@pending.test', 'Bia')
    await authGet(new Request(lastLink(), { redirect: 'manual' }))
    const row = await userRow('bia@pending.test')
    expect(row.emailVerified).toBe(true)
    expect(row.pendingSignupAt).toBeNull()
  })

  it('"conclua seu cadastro" (link de senha) confirma e limpa o marcador', async () => {
    await pendingSignup('caio@pending.test', 'Caio')
    mailer.accountSent.splice(0)
    await post('/send-verification-email', { email: 'caio@pending.test', callbackURL: '/' })
    const hop = await authGet(new Request(lastLink(), { redirect: 'manual' }))
    const token = new URL(hop.headers.get('location')!, 'http://localhost').searchParams.get('token')!
    expect((await post('/reset-password', { token, newPassword: 'outra-senha-456' })).status).toBe(200)

    const row = await userRow('caio@pending.test')
    expect(row.emailVerified).toBe(true)
    expect(row.pendingSignupAt).toBeNull()
  })

  it('email confirmado por update do adapter (admin) limpa o marcador', async () => {
    const id = await pendingSignup('dora@pending.test', 'Dora')
    const ctx = await getAuth().$context
    await ctx.internalAdapter.updateUser(id, { emailVerified: true })
    expect((await userRow('dora@pending.test')).pendingSignupAt).toBeNull()
  })

  it('outras atualizações da conta não mexem no marcador', async () => {
    const id = await pendingSignup('edu@pending.test', 'Edu')
    const ctx = await getAuth().$context
    await ctx.internalAdapter.updateUser(id, { name: 'Eduardo' })
    expect((await userRow('edu@pending.test')).pendingSignupAt).toBeInstanceOf(Date)
  })

  it('gate desligado depois do cadastro: quem entra na conta tira o marcador', async () => {
    await pendingSignup('fe@pending.test', 'Fe')
    setMailer(new FakeMailer({ accountEmailConfigured: false }))
    resetAuthForTests()
    expect((await post('/sign-in/email', { email: 'fe@pending.test', password: PASSWORD })).status).toBe(200)
    const row = await userRow('fe@pending.test')
    expect(row.emailVerified).toBe(false)
    expect(row.pendingSignupAt).toBeNull()
  })

  it('gate ligado: sessão de conta NÃO confirmada (ex.: impersonação) não tira o marcador', async () => {
    const id = await pendingSignup('gil@pending.test', 'Gil')
    const ctx = await getAuth().$context
    await ctx.internalAdapter.createSession(id)
    expect((await userRow('gil@pending.test')).pendingSignupAt).toBeInstanceOf(Date)
  })
})

describe('purgeStalePendingSignups', () => {
  it('prazo maior que a validade do link de confirmação (24h)', () => {
    expect(PENDING_SIGNUP_MAX_AGE_MS).toBeGreaterThan(24 * HOUR)
  })

  it('apaga o cadastro pendente velho, seus tokens e marcadores, e libera o email', async () => {
    const id = await pendingSignup('velho@pending.test', 'Velho')
    // Reenvio público ⇒ token de senha + marcador do teto de e-mails, ambos com o id em `verification.value`.
    await post('/send-verification-email', { email: 'velho@pending.test', callbackURL: '/' })
    expect(await getDb().select().from(verification).where(eq(verification.value, id))).not.toHaveLength(0)
    await expireResetLinks()
    await ageMarker(id, 49)

    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 1 })
    expect(await userRow('velho@pending.test')).toBeUndefined()
    expect(await getDb().select().from(account).where(eq(account.userId, id))).toHaveLength(0)
    expect(await getDb().select().from(verification).where(eq(verification.value, id))).toHaveLength(0)

    // Idempotente, e o email volta a aceitar um cadastro novo.
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
    await pendingSignup('velho@pending.test', 'Dona')
    expect((await userRow('velho@pending.test')).id).not.toBe(id)
  })

  it('link de senha ainda válido segura o expurgo até vencer', async () => {
    const id = await pendingSignup('link@pending.test')
    await post('/send-verification-email', { email: 'link@pending.test', callbackURL: '/' })
    await ageMarker(id, 49)
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
    await expireResetLinks()
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 1 })
  })

  it('lote: apaga os mais antigos primeiro, no máximo `batch` por passada', async () => {
    const older = await pendingSignup('a@pending.test')
    const newer = await pendingSignup('b@pending.test')
    await ageMarker(older, 80)
    await ageMarker(newer, 60)
    expect(await purgeStalePendingSignups(getDb(), new Date(), { batch: 1 })).toEqual({ pendingSignupsPurged: 1 })
    expect(await userRow('a@pending.test')).toBeUndefined()
    expect(await userRow('b@pending.test')).toBeDefined()
  })

  it('não apaga dentro do prazo', async () => {
    const id = await pendingSignup('novo@pending.test')
    await ageMarker(id, 47)
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
    expect(await userRow('novo@pending.test')).toBeDefined()
  })

  it('nunca por handle de espera sem marcador (conta da era do gate desligado, ou anterior ao marcador)', async () => {
    await seedUser({
      email: 'semmarca@pending.test',
      handle: 'pendente-abcdefghij012345',
      emailVerified: false,
    })
    await getDb()
      .update(users)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * HOUR) })
      .where(eq(users.email, 'semmarca@pending.test'))
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
    expect(await userRow('semmarca@pending.test')).toBeDefined()
  })

  it('guardas: marcada mas confirmada, com sessão, com Receita, com conta Google ou soft-deletada não sai', async () => {
    const verified = await pendingSignup('conf@pending.test')
    await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, verified))

    const withSession = await pendingSignup('sess@pending.test')
    await (await getAuth().$context).internalAdapter.createSession(withSession)

    const withRecipe = await pendingSignup('rec@pending.test')
    await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: withRecipe })

    const withGoogle = await pendingSignup('goog@pending.test')
    await getDb().insert(account).values({ userId: withGoogle, accountId: 'g-1', providerId: 'google' })

    const softDeleted = await pendingSignup('del@pending.test')
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, softDeleted))

    for (const id of [verified, withSession, withRecipe, withGoogle, softDeleted]) await ageMarker(id, 72)

    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
    expect(await getDb().select({ id: users.id }).from(users)).toHaveLength(5)
    expect(await getDb().select().from(session).where(eq(session.userId, withSession))).toHaveLength(1)
  })

  it('guardas de conteúdo: marcada com save ou seguindo alguém (marcador que não saiu) não é apagada', async () => {
    const saver = await pendingSignup('save@pending.test')
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await getDb().insert(recipeSave).values({ userId: saver, recipeId })

    const follower = await pendingSignup('segue@pending.test')
    const other = await seedUser({ email: 'outro@pending.test' })
    await getDb().insert(userFollow).values({ followerId: follower, followeeId: other })

    for (const id of [saver, follower]) await ageMarker(id, 72)
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 0 })
  })

  it('toda FK cascade/restrict para users (fora session/account) está nas guardas de conteúdo', () => {
    const name = (t: PgTable) => getTableConfig(t).name
    const expected = new Set<string>()
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue
      for (const fk of getTableConfig(value).foreignKeys) {
        const ref = fk.reference()
        if (name(ref.foreignTable) !== 'users' || (fk.onDelete !== 'cascade' && fk.onDelete !== 'restrict')) continue
        const key = `${name(value)}.${ref.columns[0].name}`
        if (key !== 'session.user_id' && key !== 'account.user_id') expected.add(key)
      }
    }
    const guarded = new Set(CONTENT_GUARDS.map((c) => `${name(c.table as PgTable)}.${c.name}`))
    expect(guarded).toEqual(expected)
  })
})

describe('lápide do email expurgado', () => {
  async function purgeOne(email: string): Promise<void> {
    const id = await pendingSignup(email)
    await ageMarker(id, 49)
    expect(await purgeStalePendingSignups(getDb(), new Date())).toEqual({ pendingSignupsPurged: 1 })
    mailer.accountSent.splice(0)
  }

  it('cadastro de email já expurgado manda "conclua seu cadastro", nunca um link de confirmação novo', async () => {
    await purgeOne('vitima@pending.test')
    const res = await post('/sign-up/email', { email: 'vitima@pending.test', password: 'senha-do-atacante-9', name: 'X' })
    expect(res.status).toBe(200)
    expect(mailer.accountSent).toHaveLength(1)
    expect(mailer.accountSent[0].subject).toBe('Conclua seu cadastro no Refogando')
    expect(mailer.accountSent[0].text).not.toContain('/verify-email')
    // Não guarda o email em claro.
    const rows = await getDb().select().from(verification).where(like(verification.identifier, 'pending-signup-purged:%'))
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('vitima')
  })

  it('email sem expurgo segue recebendo o link de confirmação', async () => {
    await purgeOne('outra@pending.test')
    await post('/sign-up/email', { email: 'nova@pending.test', password: PASSWORD, name: 'Nova' })
    expect(lastLink()).toContain('/verify-email')
  })

  it('a lápide vence e sai numa passada posterior', async () => {
    await purgeOne('antiga@pending.test')
    const later = new Date(Date.now() + PURGED_SIGNUP_MEMORY_MS + HOUR)
    expect(await wasPendingSignupPurged(getDb(), 'ANTIGA@pending.test', new Date())).toBe(true)
    expect(await wasPendingSignupPurged(getDb(), 'antiga@pending.test', later)).toBe(false)
    await purgeStalePendingSignups(getDb(), later)
    expect(
      await getDb().select().from(verification).where(like(verification.identifier, 'pending-signup-purged:%')),
    ).toHaveLength(0)
  })
})

describe('GET /api/cron/account-purge — cadastros pendentes', () => {
  const original = process.env.CRON_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  it('com Bearer correto, apaga o cadastro pendente velho e devolve a contagem', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    const id = await pendingSignup('cron@pending.test')
    await ageMarker(id, 49)

    const res = await cronGet(
      new Request('http://localhost/api/cron/account-purge', {
        headers: { authorization: 'Bearer segredo-de-teste' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scanned: 0, pendingSignupsPurged: 1 })
    expect(await userRow('cron@pending.test')).toBeUndefined()
  })
})

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GET as authGet, POST as authPost } from '@/app/api/auth/[...all]/route'
import { GET as profileGet } from '@/app/api/u/[handle]/route'
import { GET as cooksGet } from '@/app/api/search/cooks/route'
import { handleOAuthUserInfo } from 'better-auth/oauth2'
import { getAuth, resetAuthForTests } from '@/lib/auth'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { session, users } from '@/db/schema'
import { seedUser } from '../helpers/users'

/**
 * Confirmação de email no cadastro (#470) — pela porta HTTP real (`/api/auth/[...all]`), com o `FakeMailer` no
 * seam. Prova, antes de tudo, que `/sign-up/email` NÃO enumera contas: email já cadastrado responde com o MESMO
 * status, sem cookie, e um corpo de MESMA forma que um email novo (antes: 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL
 * vs 200). Depois, o fluxo: conta nasce não confirmada e sem sessão; o e-mail sai no idioma do request; login antes
 * de confirmar é o 401 de sempre (sem e-mail); o link confirma, loga e volta pela nossa tela `/verify-email`;
 * reenvio neutro com teto por conta; o pré-sequestro (R1); e a migração 0067 marca as contas antigas como confirmadas.
 * Tudo isto com o e-mail de conta configurado — sem ele, ver email-verification-off.test.ts.
 */

const PASSWORD = 'senha-segura-123'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

let mailer: FakeMailer

beforeEach(() => {
  // E-mail de conta CONFIGURADO (default do FakeMailer) ⇒ o gate de `buildAuth` liga a confirmação. A instância
  // é refeita para ler o gate com ESTE mailer (ver email-verification-off.test.ts para o gate desligado).
  mailer = new FakeMailer()
  setMailer(mailer)
  resetAuthForTests()
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

  it('login antes de confirmar: o 401 de credencial inválida, sem sessão e SEM e-mail (R1: sendOnSignIn desligado)', async () => {
    await signUp('cedo@verify.test')
    mailer.accountSent.splice(0)

    const res = await post('/sign-in/email', { email: 'cedo@verify.test', password: PASSWORD })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await sessionsOf((await userRow('cedo@verify.test')).id)).toHaveLength(0)
    expect(mailer.accountSent).toHaveLength(0)

    // Senha errada de conta não confirmada: o mesmo 401, sem e-mail.
    const wrong = await post('/sign-in/email', { email: 'cedo@verify.test', password: 'errada-123456' })
    expect(wrong.status).toBe(401)
    expect(mailer.accountSent).toHaveLength(0)
    expect(getAuth().options.emailVerification?.sendOnSignIn).toBe(false)
  })

  it('R1 — pré-sequestro: a vítima cadastra DEPOIS do atacante e recebe "conclua seu cadastro"; o login do atacante não manda nada', async () => {
    const P_A = 'senha-do-atacante-1'
    await post('/sign-up/email', { email: 'alvo@verify.test', password: P_A, name: 'Atacante' })
    const userId = (await userRow('alvo@verify.test')).id
    mailer.accountSent.splice(0) // o link de confirmação do cadastro do atacante (resíduo aceito no ADR, sem limite de tempo)

    // Vítima cadastra o próprio email: resposta genérica de sempre, e o e-mail que chega é o link de SENHA.
    const res = await signUp('alvo@verify.test', 'Vitima')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(mailer.accountSent).toHaveLength(1)
    expect(mailer.accountSent[0].subject).toBe('Conclua seu cadastro no Refogando')
    const finish = new URL(lastLink())
    expect(finish.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/)

    // Atacante entra com a senha dele logo depois: 401 e NENHUM link de confirmação sai para a vítima clicar.
    const a = await post('/sign-in/email', { email: 'alvo@verify.test', password: P_A })
    expect(a.status).toBe(401)
    expect(mailer.accountSent).toHaveLength(1)

    // Vítima conclui: a senha dela vale, a do atacante não, conta confirmada.
    const hop = await authGet(new Request(finish.toString(), { redirect: 'manual' }))
    const token = new URL(hop.headers.get('location')!, 'http://localhost').searchParams.get('token')!
    expect((await post('/reset-password', { token, newPassword: 'senha-da-vitima-2' })).status).toBe(200)
    expect((await userRow('alvo@verify.test')).emailVerified).toBe(true)
    expect(await sessionsOf(userId)).toHaveLength(0)
    expect((await post('/sign-in/email', { email: 'alvo@verify.test', password: P_A })).status).toBe(401)
    expect((await post('/sign-in/email', { email: 'alvo@verify.test', password: 'senha-da-vitima-2' })).status).toBe(200)
  })

  it('R1 — cadastro repetido de conta pendente: mesma resposta que um email novo; teto de 3 por conta', async () => {
    await signUp('repete@verify.test')
    mailer.accountSent.splice(0)
    const fresh = await signUp('inedito@verify.test')
    const dup = await signUp('repete@verify.test')
    expect(dup.status).toBe(fresh.status)
    expect(shape(await dup.json())).toEqual(shape(await fresh.json()))
    mailer.accountSent.splice(0)
    for (let i = 0; i < 4; i++) await signUp('repete@verify.test')
    // 1 do `dup` acima + 2 aqui = teto de 3 e-mails de senha na janela.
    expect(mailer.accountSent.filter((m) => m.to === 'repete@verify.test')).toHaveLength(2)
  })

  it('F1 — cadastrar X/P e entrar com X/P não enumera: conta NOVA não confirmada = conta EXISTENTE com senha errada', async () => {
    await existingAccount('ja-existe@verify.test') // senha do dono: PASSWORD
    // Atacante: cadastra os dois emails com a senha P dele (ambos 200) e tenta entrar com X/P.
    const P = 'senha-do-atacante-1'
    for (const email of ['novo@verify.test', 'ja-existe@verify.test']) {
      expect((await post('/sign-up/email', { email, password: P, name: 'X' })).status).toBe(200)
    }
    const a = await post('/sign-in/email', { email: 'novo@verify.test', password: P }) // conta nova, não confirmada
    const b = await post('/sign-in/email', { email: 'ja-existe@verify.test', password: P }) // existente, senha errada
    expect(a.status).toBe(b.status)
    expect(a.status).toBe(401)
    expect(await a.json()).toEqual(await b.json())
    expect([...a.headers.entries()].sort()).toEqual([...b.headers.entries()].sort())
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

  it('reenvio: MESMA resposta (status, corpo, headers) para conta não confirmada, confirmada e inexistente; só a não confirmada recebe', async () => {
    await signUp('pendente@verify.test')
    await existingAccount('confirmada@verify.test')
    mailer.accountSent.splice(0)

    const responses = []
    for (const email of ['pendente@verify.test', 'confirmada@verify.test', 'ninguem@verify.test']) {
      const res = await post('/send-verification-email', { email, callbackURL: '/' })
      responses.push({ status: res.status, body: await res.json(), headers: [...res.headers.entries()].sort() })
    }
    expect(responses[0].status).toBe(200)
    expect(responses[1]).toEqual(responses[0])
    expect(responses[2]).toEqual(responses[0])
    expect(mailer.accountSent.map((m) => m.to)).toEqual(['pendente@verify.test'])
  })

  it('B1 — reenvio público manda "conclua seu cadastro" (link de SENHA); concluir troca a senha do atacante, confirma e derruba sessões', async () => {
    // Atacante pré-cadastra o email da vítima com a senha dele (P_a) e deixa uma sessão aberta.
    const P_A = 'senha-do-atacante-1'
    await post('/sign-up/email', { email: 'vitima@verify.test', password: P_A, name: 'Atacante' })
    const userId = (await userRow('vitima@verify.test')).id
    const ctx = await getAuth().$context
    await ctx.internalAdapter.createSession(userId)
    mailer.accountSent.splice(0)

    // Vítima: "Reenviar email" (público, sem sessão).
    const res = await post('/send-verification-email', { email: 'vitima@verify.test', callbackURL: '/' })
    expect(res.status).toBe(200)
    expect(mailer.accountSent).toHaveLength(1)
    const mail = mailer.accountSent[0]
    expect(mail.subject).toBe('Conclua seu cadastro no Refogando')
    const link = new URL(lastLink())
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/)
    // O link de CONFIRMAÇÃO simples não sai — ele confirmaria a conta do atacante com a senha dele.
    expect(mail.text).not.toContain('/verify-email')

    const hop = await authGet(new Request(link.toString(), { redirect: 'manual' }))
    const target = new URL(hop.headers.get('location')!, 'http://localhost')
    expect(target.pathname).toBe('/pt-BR/reset-password')
    const token = target.searchParams.get('token')!
    expect((await post('/reset-password', { token, newPassword: 'senha-da-vitima-2' })).status).toBe(200)

    const row = await userRow('vitima@verify.test')
    expect(row.emailVerified).toBe(true)
    expect(row.handle).toBe('atacante') // F2: provado o email, o handle de espera vira o do nome
    expect(await sessionsOf(userId)).toHaveLength(0)
    expect((await post('/sign-in/email', { email: 'vitima@verify.test', password: P_A })).status).toBe(401)
    expect((await post('/sign-in/email', { email: 'vitima@verify.test', password: 'senha-da-vitima-2' })).status).toBe(200)
  })

  it('no máx. 3 e-mails de confirmação por conta na janela, mesmo com pedidos EM PARALELO (F4)', async () => {
    await signUp('bomba@verify.test') // 1º
    // Chamada de servidor (sem request): cai no caminho do link de confirmação, com o teto `verify`.
    await Promise.all(
      Array.from({ length: 6 }, () => getAuth().api.sendVerificationEmail({ body: { email: 'bomba@verify.test' } })),
    )
    expect(mailer.accountSent).toHaveLength(3)
    expect(mailer.accountSent.every((m) => m.subject === 'Confirme seu email no Refogando')).toBe(true)
  })

  it('no máx. 3 e-mails de SENHA por conta, mesmo com reenvios públicos EM PARALELO (lock também no teto `password`)', async () => {
    await signUp('bomba3@verify.test')
    mailer.accountSent.splice(0)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('/send-verification-email', { email: 'bomba3@verify.test' })),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(mailer.accountSent).toHaveLength(3)
  })

  it('reenvio público: no máx. 3 e-mails de "conclua seu cadastro" por conta na janela (teto do reset)', async () => {
    await signUp('bomba2@verify.test')
    mailer.accountSent.splice(0)
    for (let i = 0; i < 5; i++) {
      expect((await post('/send-verification-email', { email: 'bomba2@verify.test' })).status).toBe(200)
    }
    expect(mailer.accountSent).toHaveLength(3)
  })

  it('B3 — envio recusado pelo provedor deixa UMA linha warn, sem o email', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setMailer({
      canSendAccountEmail: () => true,
      sendDpoAlert: async () => ({ sent: false }),
      sendAccountEmail: async () => ({ sent: false }),
    })
    resetAuthForTests()
    await signUp('recusado@verify.test')
    const ours = warn.mock.calls.filter((call) => String(call[0]).startsWith('[auth]'))
    expect(ours).toHaveLength(1)
    expect(String(ours[0][0])).toContain('(verify)')
    expect(JSON.stringify(ours)).not.toContain('recusado')
    warn.mockRestore()
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
    expect((await post('/sign-in/email', { email: 'legado@mig.test', password: PASSWORD })).status).toBe(401)
    await getDb().execute(sql.raw(migration))
    expect((await post('/sign-in/email', { email: 'legado@mig.test', password: PASSWORD })).status).toBe(200)
  })
})

describe('F2 — conta pendente não expõe handle derivável nem aparece em público (#470)', () => {
  it('nasce com handle de ESPERA; perfil e busca a escondem; confirmar dá o handle do nome (com a desambiguação)', async () => {
    await seedUser({ email: 'dona@f2.test', name: 'Zuleica', handle: 'zuleica' })
    await signUp('nova@f2.test', 'Zuleica')
    const row = await userRow('nova@f2.test')
    expect(row.handle).toMatch(/^pendente-[a-z0-9]{16}$/)

    expect((await profileGet(new Request(`http://localhost/api/u/${row.handle}`), {
      params: Promise.resolve({ handle: row.handle }),
    })).status).toBe(404)
    const search = async () =>
      (await (await cooksGet(new Request('http://localhost/api/search/cooks?q=Zuleica'))).json()) as {
        cooks: Array<{ handle: string }>
      }
    expect((await search()).cooks.map((c) => c.handle)).toEqual(['zuleica'])

    await authGet(new Request(lastLink(), { redirect: 'manual' }))
    const verified = await userRow('nova@f2.test')
    expect(verified.handle).toBe('zuleica-2')
    expect((await profileGet(new Request('http://localhost/api/u/zuleica-2'), {
      params: Promise.resolve({ handle: 'zuleica-2' }),
    })).status).toBe(200)
    expect((await search()).cooks.map((c) => c.handle).sort()).toEqual(['zuleica', 'zuleica-2'])
  })

  it('R2 — conta criada NÃO confirmada com o gate DESLIGADO (handle do nome) segue pública com o gate ligado', async () => {
    await seedUser({ email: 'era-off@f2.test', name: 'Genoveva', handle: 'genoveva', emailVerified: false })
    expect((await profileGet(new Request('http://localhost/api/u/genoveva'), {
      params: Promise.resolve({ handle: 'genoveva' }),
    })).status).toBe(200)
    const found = (await (await cooksGet(new Request('http://localhost/api/search/cooks?q=Genoveva'))).json()) as {
      cooks: Array<{ handle: string }>
    }
    expect(found.cooks.map((c) => c.handle)).toEqual(['genoveva'])
  })

  it('R2 — `pendente-silva` (handle de NOME com o prefixo, de antes da reserva) nunca é tratado como pendente', async () => {
    await seedUser({ email: 'silva@f2.test', name: 'Pendente Silva', handle: 'pendente-silva', emailVerified: false })
    expect((await profileGet(new Request('http://localhost/api/u/pendente-silva'), {
      params: Promise.resolve({ handle: 'pendente-silva' }),
    })).status).toBe(200)
  })

  it('R2 — conta com handle de espera mas JÁ confirmada (handle do nome não coube) é pública', async () => {
    await seedUser({ email: 'sorte@f2.test', name: 'Sorte', handle: 'pendente-0123456789abcdef', emailVerified: true })
    expect((await profileGet(new Request('http://localhost/api/u/pendente-0123456789abcdef'), {
      params: Promise.resolve({ handle: 'pendente-0123456789abcdef' }),
    })).status).toBe(200)
  })

  it('cadastro com o gate ligado não reserva o handle do nome (sem "-2" pro próximo)', async () => {
    await signUp('a@f2.test', 'Joaquina')
    await signUp('b@f2.test', 'Joaquina')
    const handles = [(await userRow('a@f2.test')).handle, (await userRow('b@f2.test')).handle]
    expect(handles.every((h) => /^pendente-/.test(h))).toBe(true)
    expect(handles[0]).not.toBe(handles[1])
  })
})

describe('F3 — sem vínculo implícito conta↔Google (#470)', () => {
  const google = (id: string, email: string) => ({
    userInfo: { id, email, emailVerified: true, name: 'Gi', image: undefined },
    account: { providerId: 'google', accountId: id, accessToken: 'at', refreshToken: undefined, idToken: undefined },
    callbackURL: '/',
  })

  it('config: disableImplicitLinking ligado', () => {
    expect(getAuth().options.account?.accountLinking?.disableImplicitLinking).toBe(true)
  })

  it('conta de email+senha (confirmada) NÃO é tomada pelo Google do mesmo email: "account not linked"', async () => {
    await existingAccount('dupla@f3.test')
    const c = { context: await getAuth().$context } as unknown as Parameters<typeof handleOAuthUserInfo>[0]
    const out = await handleOAuthUserInfo(c, google('g-111', 'dupla@f3.test'))
    expect(out.error).toBe('account not linked')
    expect(out.data).toBeNull()
  })

  it('conta criada pelo Google ganha handle do NOME mesmo com email_verified=false do provedor (sem handle de espera)', async () => {
    const c = { context: await getAuth().$context } as unknown as Parameters<typeof handleOAuthUserInfo>[0]
    const g = google('g-333', 'nao-verificado@f3.test')
    const out = await handleOAuthUserInfo(c, { ...g, userInfo: { ...g.userInfo, name: 'Genésia', emailVerified: false } })
    expect(out.error).toBeNull()
    expect((await userRow('nao-verificado@f3.test')).handle).toMatch(/^genesia(-\d+)?$/)
  })

  it('o hook de criação só dá handle de espera ao cadastro de email+senha (caminho do endpoint)', async () => {
    const before = getAuth().options.databaseHooks!.user!.create!.before!
    const data = { name: 'Clotilde', email: 'x@f3.test', emailVerified: false } as never
    const handleFor = async (path: string | null) => {
      const out = (await before(data, (path ? { path } : null) as never)) as { data: { handle: string } }
      return out.data.handle
    }
    expect(await handleFor('/sign-up/email')).toMatch(/^pendente-[a-z0-9]{16}$/)
    for (const path of ['/callback/:id', '/sign-in/social', '/admin/create-user', null]) {
      expect(await handleFor(path)).toBe('clotilde')
    }
  })

  it('quem entrou pelo Google continua entrando (vínculo achado pelo accountId), com handle do nome', async () => {
    const c = { context: await getAuth().$context } as unknown as Parameters<typeof handleOAuthUserInfo>[0]
    const first = await handleOAuthUserInfo(c, google('g-222', 'gi@f3.test'))
    expect(first.error).toBeNull()
    expect(first.isRegister).toBe(true)
    const again = await handleOAuthUserInfo(c, google('g-222', 'gi@f3.test'))
    expect(again.error).toBeNull()
    expect(again.isRegister).toBe(false)
    expect(again.data?.user.id).toBe(first.data?.user.id)
    // Google chega com email confirmado ⇒ handle do nome direto (sem espera). "Gi" é curto ⇒ fallback `user`.
    expect((await userRow('gi@f3.test')).handle).toMatch(/^user(-\d+)?$/)
  })
})

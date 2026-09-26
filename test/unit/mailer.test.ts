import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealResendMailer, FakeMailer } from '@/server/mail/mailer'

/**
 * Mailer REAL Resend (#413) — caminho de REDE com `fetch` mockado (credenciais via `vi.stubEnv`). Prova:
 * fail-closed (sem `RESEND_API_KEY` / sem `DSAR_MAIL_FROM` / sem destinatário → `{ sent:false }` SEM tocar a
 * rede), o POST a `api.resend.com/emails` com `Authorization: Bearer` e corpo `from/to/subject/text/html`, e que
 * QUALQUER erro (HTTP não-ok / exceção) vira `{ sent:false }` (NUNCA lança). O `FakeMailer` cobre o fluxo
 * dos consumidores em `dpo-alert.test.ts`.
 */

const KEY = 're_test_key'
const FROM = 'encarregado@refogando.example'
const TO = 'dpo@refogando.example'
const mailer = new RealResendMailer()

type Reply = { ok: boolean; status?: number } | { throw: true }

function mockFetch(reply: Reply) {
  const impl = vi.fn(async () => {
    if ('throw' in reply) throw new TypeError('network down')
    return { ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 500) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

const input = { to: TO, subject: 'Alerta', text: 'corpo do alerta' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('RealResendMailer (#413) — fail-closed (não toca a rede)', () => {
  it('sem RESEND_API_KEY → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })

  it('sem DSAR_MAIL_FROM → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', '')
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })

  it('sem destinatário → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert({ ...input, to: '   ' })).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('RealResendMailer (#413) — envio + degradação', () => {
  it('com credencial completa: POST com Bearer e corpo Resend; { sent:true }', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const calls: Array<{ url: string; init: RequestInit }> = []
    const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit })
      return { ok: true, status: 200 } as Response
    })
    vi.stubGlobal('fetch', impl)

    expect(await mailer.sendDpoAlert({ ...input, html: '<p>oi</p>' })).toEqual({ sent: true })
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${KEY}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(init.body))).toEqual({
      from: FROM,
      to: [TO],
      subject: 'Alerta',
      text: 'corpo do alerta',
      html: '<p>oi</p>',
    })
  })

  it('sem html: o campo html não vai no corpo', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return { ok: true, status: 200 } as Response
      }),
    )
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: true })
    expect(bodies[0]).not.toHaveProperty('html')
  })

  it('remetente com nome ("Nome <addr>") é repassado como está no from', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', `Refogando <${FROM}>`)
    const bodies: Array<{ from: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return { ok: true, status: 200 } as Response
      }),
    )
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: true })
    expect(bodies[0].from).toBe(`Refogando <${FROM}>`)
  })

  it('HTTP não-ok (ex.: 403) → { sent:false } (degrada, não lança) e o log leva só o status (sem PII)', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch({ ok: false, status: 403 })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = String(warn.mock.calls[0][0])
    expect(logged).toContain('403')
    expect(logged).not.toContain(TO)
    expect(logged).not.toContain(FROM)
    warn.mockRestore()
  })

  it('exceção de rede → { sent:false } (nunca lança)', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    mockFetch({ throw: true })
    await expect(mailer.sendDpoAlert(input)).resolves.toEqual({ sent: false })
  })
})

describe('RealResendMailer.sendAccountEmail (#469) — remetente de conta', () => {
  function captureSender() {
    const bodies: Array<{ from: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return { ok: true, status: 200 } as Response
      }),
    )
    return bodies
  }

  it('usa AUTH_MAIL_FROM quando definido', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('AUTH_MAIL_FROM', 'nao-responda@refogando.example')
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const bodies = captureSender()
    expect(await mailer.sendAccountEmail(input)).toEqual({ sent: true })
    expect(bodies[0].from).toBe('nao-responda@refogando.example')
  })

  it('sem AUTH_MAIL_FROM (ou vazio) cai no DSAR_MAIL_FROM', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('AUTH_MAIL_FROM', '')
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const bodies = captureSender()
    expect(await mailer.sendAccountEmail(input)).toEqual({ sent: true })
    expect(bodies[0].from).toBe(FROM)
  })

  it('sem nenhum remetente → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('AUTH_MAIL_FROM', '')
    vi.stubEnv('DSAR_MAIL_FROM', '')
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendAccountEmail(input)).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('RealResendMailer.canSendAccountEmail (#470) — liga a confirmação de email', () => {
  it.each([
    ['chave + AUTH_MAIL_FROM', KEY, 'nao-responda@refogando.example', '', true],
    ['chave + só DSAR_MAIL_FROM (fallback)', KEY, '', FROM, true],
    ['sem chave', '', 'nao-responda@refogando.example', FROM, false],
    ['chave sem nenhum remetente (env vazia)', KEY, '', '', false],
  ])('%s → %s', (_caso, key, authFrom, dsarFrom, expected) => {
    vi.stubEnv('RESEND_API_KEY', key)
    vi.stubEnv('AUTH_MAIL_FROM', authFrom)
    vi.stubEnv('DSAR_MAIL_FROM', dsarFrom)
    const impl = mockFetch({ ok: true })
    expect(mailer.canSendAccountEmail()).toBe(expected)
    expect(impl).not.toHaveBeenCalled()
  })

  it('lê a env na CHAMADA (preguiçoso), não na construção', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const m = new RealResendMailer()
    expect(m.canSendAccountEmail()).toBe(false)
    vi.stubEnv('RESEND_API_KEY', KEY)
    expect(m.canSendAccountEmail()).toBe(true)
  })
})

describe('FakeMailer (#413) — dublê de teste', () => {
  it('canSendAccountEmail: true por padrão, configurável (#470)', () => {
    expect(new FakeMailer().canSendAccountEmail()).toBe(true)
    const off = new FakeMailer({ accountEmailConfigured: false })
    expect(off.canSendAccountEmail()).toBe(false)
    off.accountEmailConfigured = true
    expect(off.canSendAccountEmail()).toBe(true)
  })

  it('guarda os enviados e retorna { sent:true }', async () => {
    const fake = new FakeMailer()
    expect(await fake.sendDpoAlert(input)).toEqual({ sent: true })
    expect(fake.sent).toEqual([input])
  })

  it('e-mails de conta vão pra lista própria (#469)', async () => {
    const fake = new FakeMailer()
    expect(await fake.sendAccountEmail(input)).toEqual({ sent: true })
    expect(fake.accountSent).toEqual([input])
    expect(fake.sent).toEqual([])
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealBrevoMailer, FakeMailer } from '@/server/mail/mailer'

/**
 * Mailer REAL Brevo (#413) — caminho de REDE com `fetch` mockado (credenciais via `vi.stubEnv`). Prova:
 * fail-closed (sem `BREVO_API_KEY` / sem `DSAR_MAIL_FROM` / sem destinatário → `{ sent:false }` SEM tocar a
 * rede), o POST ao endpoint transacional com header `api-key` e corpo `sender/to/subject/textContent`, e que
 * QUALQUER erro (HTTP não-ok / exceção) vira `{ sent:false }` (NUNCA lança). O `FakeMailer` cobre o fluxo
 * dos consumidores em `dpo-alert.test.ts`.
 */

const KEY = 'brevo-test-key'
const FROM = 'encarregado@refogando.example'
const TO = 'dpo@refogando.example'
const mailer = new RealBrevoMailer()

type Reply = { ok: boolean; status?: number } | { throw: true }

function mockFetch(reply: Reply) {
  const impl = vi.fn(async () => {
    if ('throw' in reply) throw new TypeError('network down')
    return { ok: reply.ok, status: reply.status ?? (reply.ok ? 201 : 500) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

const input = { to: TO, subject: 'Alerta', text: 'corpo do alerta' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('RealBrevoMailer (#413) — fail-closed (não toca a rede)', () => {
  it('sem BREVO_API_KEY → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('BREVO_API_KEY', '')
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })

  it('sem DSAR_MAIL_FROM → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('BREVO_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', '')
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })

  it('sem destinatário → { sent:false } e fetch não é chamado', async () => {
    vi.stubEnv('BREVO_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const impl = mockFetch({ ok: true })
    expect(await mailer.sendDpoAlert({ ...input, to: '   ' })).toEqual({ sent: false })
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('RealBrevoMailer (#413) — envio + degradação', () => {
  it('com credencial completa: POST com header api-key e corpo Brevo; { sent:true }', async () => {
    vi.stubEnv('BREVO_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    const calls: Array<{ url: string; init: RequestInit }> = []
    const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit })
      return { ok: true, status: 201 } as Response
    })
    vi.stubGlobal('fetch', impl)

    expect(await mailer.sendDpoAlert({ ...input, html: '<p>oi</p>' })).toEqual({ sent: true })
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toContain('api.brevo.com')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['api-key']).toBe(KEY)
    const body = JSON.parse(String(init.body)) as {
      sender: { email: string }
      to: Array<{ email: string }>
      subject: string
      textContent: string
      htmlContent?: string
    }
    expect(body.sender.email).toBe(FROM)
    expect(body.to).toEqual([{ email: TO }])
    expect(body.subject).toBe('Alerta')
    expect(body.textContent).toBe('corpo do alerta')
    expect(body.htmlContent).toBe('<p>oi</p>')
  })

  it('HTTP não-ok (ex.: 401) → { sent:false } (degrada, não lança)', async () => {
    vi.stubEnv('BREVO_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    mockFetch({ ok: false, status: 401 })
    expect(await mailer.sendDpoAlert(input)).toEqual({ sent: false })
  })

  it('exceção de rede → { sent:false } (nunca lança)', async () => {
    vi.stubEnv('BREVO_API_KEY', KEY)
    vi.stubEnv('DSAR_MAIL_FROM', FROM)
    mockFetch({ throw: true })
    await expect(mailer.sendDpoAlert(input)).resolves.toEqual({ sent: false })
  })
})

describe('FakeMailer (#413) — dublê de teste', () => {
  it('guarda os enviados e retorna { sent:true }', async () => {
    const fake = new FakeMailer()
    expect(await fake.sendDpoAlert(input)).toEqual({ sent: true })
    expect(fake.sent).toEqual([input])
  })
})

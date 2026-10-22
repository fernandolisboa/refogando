/**
 * `POST /api/client-errors` (#590, ADR-0048). A fábrica `createClientErrorIntake` recebe relógio e saída de
 * log injetáveis; o `POST` do `route.ts` é exercitado uma vez para provar a ligação. Sem banco: roda no
 * projeto "ui".
 *
 * Cobre a ordem do intake (cross-site ⇒ por IP ⇒ teto da instância ⇒ tamanho ⇒ schema), a re-sanitização
 * do corpo não confiável (PII e tentativa de injetar linha) e o "nunca 500".
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientErrorIntake } from '@/server/http/client-error-intake'
import { POST } from '@/app/api/client-errors/route'

const URL_ = 'http://localhost/api/client-errors'
const valid = { v: 1, tipo: 'janela', rota: '/pt-BR/recipes/bolo', erro: 'TypeError', msg: "x (reading 'title')" }

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Corpo em stream (sem content-length), para provar o teto na leitura. */
function postStream(chunks: string[], headers: Record<string, string> = {}): Request {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Request(URL_, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit)
}

function setup(opts: { perInstancePerMinute?: number } = {}) {
  let t = 1_000_000
  const lines: string[] = []
  const intake = createClientErrorIntake({ now: () => t, log: (l) => lines.push(l), ...opts })
  return {
    intake,
    lines,
    advance(ms: number) {
      t += ms
    },
  }
}

describe('createClientErrorIntake', () => {
  it('relato válido ⇒ 204 no-store e UMA linha sanitizada', async () => {
    const { intake, lines } = setup()
    const res = await intake(post(valid, { 'x-real-ip': '1.1.1.1' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(lines).toEqual([
      `[erro] origem=cliente rota=/[locale]/recipes/[param] tipo=janela erro=TypeError digest=- msg="x (reading 'title')"`,
    ])
  })

  it('re-sanitiza o corpo: PII some e uma quebra de linha não forja outra linha [erro]', async () => {
    const { intake, lines } = setup()
    const res = await intake(
      post({
        v: 1,
        tipo: 'janela',
        rota: '/pt-BR/u/maria?token=abc',
        erro: 'Erro de maria',
        msg: 'falhou p/ maria@x.com\n[erro] origem=servidor rota=/forjada',
      }),
    )
    expect(res.status).toBe(204)
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toMatch(/\n/)
    expect(lines[0]).not.toContain('maria')
    expect(lines[0]).not.toContain('token')
    expect(lines[0]).toBe(
      '[erro] origem=cliente rota=/[locale]/u/[param] tipo=janela erro=Error digest=- msg="falhou p/ <email> [erro] origem=servidor rota=<url>"',
    )
  })

  it.each([
    ['JSON inválido', '{nope'],
    ['schema errado', { v: 1, tipo: 'qualquer', rota: '/', erro: 'E' }],
    ['array', []],
    ['vazio', ''],
  ])('%s ⇒ 400 sem linha', async (_, body) => {
    const { intake, lines } = setup()
    const res = await intake(post(body))
    expect(res.status).toBe(400)
    expect(lines).toEqual([])
  })

  it('sem corpo ⇒ 400', async () => {
    const { intake } = setup()
    const res = await intake(new Request(URL_, { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('content-length acima de 2 KB ⇒ 413 antes de ler', async () => {
    const { intake, lines } = setup()
    const res = await intake(post({ ...valid, msg: 'a'.repeat(3000) }))
    expect(res.status).toBe(413)
    expect(lines).toEqual([])
  })

  it('stream sem content-length acima de 2 KB ⇒ 413 (teto na leitura)', async () => {
    const { intake, lines } = setup()
    const res = await intake(postStream(['{"v":1,"msg":"', 'a'.repeat(1500), 'a'.repeat(1500), '"}']))
    expect(res.status).toBe(413)
    expect(lines).toEqual([])
  })

  it('stream pequeno sem content-length é lido normalmente', async () => {
    const { intake, lines } = setup()
    const res = await intake(postStream([JSON.stringify(valid).slice(0, 10), JSON.stringify(valid).slice(10)]))
    expect(res.status).toBe(204)
    expect(lines).toHaveLength(1)
  })

  it('1 relato/s por IP: 429 { error: rate_limited } e libera depois de 1s', async () => {
    const { intake, lines, advance } = setup()
    expect((await intake(post(valid, { 'x-real-ip': '9.9.9.9' }))).status).toBe(204)
    const blocked = await intake(post(valid, { 'x-real-ip': '9.9.9.9' }))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'rate_limited' })
    expect((await intake(post(valid, { 'x-real-ip': '8.8.8.8' }))).status).toBe(204) // outro IP passa
    advance(1000)
    expect((await intake(post(valid, { 'x-real-ip': '9.9.9.9' }))).status).toBe(204)
    expect(lines).toHaveLength(3)
  })

  it('sem IP pula o limite por IP, mas o teto da instância continua', async () => {
    const { intake, lines, advance } = setup({ perInstancePerMinute: 3 })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await intake(post(valid))).status)
    expect(statuses).toEqual([204, 204, 204, 429, 429, 429])
    // 3 linhas de relato + UMA de limite na janela inteira.
    expect(lines.filter((l) => l.includes('limite=atingido'))).toEqual(['[erro] origem=cliente limite=atingido'])
    expect(lines).toHaveLength(4)
    advance(60_000) // janela nova
    expect((await intake(post(valid))).status).toBe(204)
    expect(lines).toHaveLength(5)
  })

  it('Sec-Fetch-Site de outro site ⇒ 204 sem log', async () => {
    const { intake, lines } = setup()
    for (const site of ['cross-site', 'same-site', 'none']) {
      const res = await intake(post(valid, { 'sec-fetch-site': site }))
      expect(res.status).toBe(204)
    }
    expect(lines).toEqual([])
  })

  it('Sec-Fetch-Site ausente passa (cliente sem o header)', async () => {
    const { intake, lines } = setup()
    const res = await intake(new Request(URL_, { method: 'POST', body: JSON.stringify(valid) }))
    expect(res.status).toBe(204)
    expect(lines).toHaveLength(1)
  })

  it('falha inesperada na leitura ⇒ 400, nunca 500', async () => {
    const { intake } = setup()
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('stream quebrou')
      },
    })
    const req = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect((await intake(req)).status).toBe(400)
  })
})

describe('POST /api/client-errors (route.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('liga a fábrica: 204 e a linha sai em console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await POST(post(valid, { 'x-real-ip': '7.7.7.7' }))
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[erro\] origem=cliente rota=\/\[locale\]\/recipes\/\[param\] /)
  })
})

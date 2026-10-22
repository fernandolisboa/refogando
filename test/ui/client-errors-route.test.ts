/**
 * `POST /api/client-errors` (#590, ADR-0048). A fábrica `createClientErrorIntake` recebe relógio e saída de
 * log injetáveis; o `POST` do `route.ts` é exercitado uma vez para provar a ligação. Sem banco: roda no
 * projeto "ui".
 *
 * Cobre a ordem do intake (cross-site ⇒ rajada por IP ⇒ teto da instância ⇒ tamanho ⇒ schema), a
 * re-sanitização do corpo não confiável (PII, linha e chave forjadas), o teto contando LINHAS e o "nunca 500".
 * O limitador por IP (`createIpBurstLimiter`/`ipRateKey`) é testado à parte no fim.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientErrorIntake } from '@/server/http/client-error-intake'
import { createIpBurstLimiter, ipRateKey } from '@/server/http/ip-burst-limit'
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

function setup(opts: { perInstancePerMinute?: number; perIpBurst?: number } = {}) {
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

  it('re-sanitiza o corpo: PII some e uma quebra de linha não forja outra linha [erro] nem chave', async () => {
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
      '[erro] origem=cliente rota=/[locale]/u/[param] tipo=janela erro=Error digest=- msg="falhou p/ <email> (erro) origem:servidor rota:<url>"',
    )
    // Busca por substring do catálogo: a mensagem não casa `origem=servidor` nem uma 2ª tag `[erro]`.
    expect(lines[0]).not.toContain('origem=servidor')
    expect(lines[0].split('[erro]')).toHaveLength(2)
  })

  it('msg com chaves forjadas (tipo=, digest=) não casa as buscas do catálogo', async () => {
    const { intake, lines } = setup()
    await intake(post({ ...valid, msg: 'x tipo=hidratacao digest=123 [ERRO]' }))
    expect(lines).toEqual([
      '[erro] origem=cliente rota=/[locale]/recipes/[param] tipo=janela erro=TypeError digest=- msg="x tipo:hidratacao digest:123 (erro)"',
    ])
  })

  it.each([
    ['JSON inválido', '{nope'],
    ['schema errado', { v: 1, tipo: 'qualquer', rota: '/', erro: 'E' }],
    ['array', []],
    ['vazio', ''],
  ])('%s ⇒ 400 { error: dados_invalidos } sem linha', async (_, body) => {
    const { intake, lines } = setup()
    const res = await intake(post(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'dados_invalidos' })
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

  it('rajada por IP: 5 em 10 s passam (boundary + rejeição, #418 + #423), a 6ª ⇒ 429 rate_limited', async () => {
    const { intake, lines, advance } = setup()
    const ip = { 'x-real-ip': '9.9.9.9' }
    for (let i = 0; i < 5; i++) expect((await intake(post(valid, ip))).status).toBe(204)
    const blocked = await intake(post(valid, ip))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'rate_limited' })
    expect((await intake(post(valid, { 'x-real-ip': '8.8.8.8' }))).status).toBe(204) // outro IP passa
    advance(9_999)
    expect((await intake(post(valid, ip))).status).toBe(429)
    advance(1)
    expect((await intake(post(valid, ip))).status).toBe(204)
    expect(lines).toHaveLength(7)
  })

  it('um IP sozinho não enche o teto da instância', async () => {
    const { intake, lines } = setup()
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) statuses.push((await intake(post(valid, { 'x-real-ip': '6.6.6.6' }))).status)
    expect(statuses.filter((s) => s === 204)).toHaveLength(5)
    expect(lines.some((l) => l.includes('limite=atingido'))).toBe(false)
    expect((await intake(post(valid, { 'x-real-ip': '5.5.5.5' }))).status).toBe(204)
  })

  it('IPv6: a /64 inteira divide a mesma rajada', async () => {
    const { intake } = setup({ perIpBurst: 2 })
    expect((await intake(post(valid, { 'x-real-ip': '2001:db8:1:2::1' }))).status).toBe(204)
    expect((await intake(post(valid, { 'x-forwarded-for': '2001:db8:1:2:ffff::9, 10.0.0.1' }))).status).toBe(204)
    expect((await intake(post(valid, { 'x-real-ip': '2001:0db8:0001:0002:abcd::' }))).status).toBe(429)
    expect((await intake(post(valid, { 'x-real-ip': '2001:db8:1:3::1' }))).status).toBe(204) // outra /64
  })

  it('o teto da instância conta LINHAS: request de lixo (400/413) não gasta o orçamento', async () => {
    const { intake, lines } = setup({ perInstancePerMinute: 2 })
    for (let i = 0; i < 5; i++) expect((await intake(post('{nope'))).status).toBe(400)
    expect((await intake(post({ ...valid, msg: 'a'.repeat(3000) }))).status).toBe(413)
    expect((await intake(post(valid))).status).toBe(204)
    expect((await intake(post(valid))).status).toBe(204)
    expect((await intake(post(valid))).status).toBe(429)
    expect(lines).toHaveLength(3) // 2 relatos + 1 limite=atingido
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

describe('createIpBurstLimiter', () => {
  function clock() {
    let t = 0
    return { now: () => t, advance: (ms: number) => (t += ms) }
  }

  it('max por janela fixa; bloqueado não estende a janela', () => {
    const c = clock()
    const rl = createIpBurstLimiter({ max: 2, windowMs: 1000, now: c.now })
    expect([rl.tryAcquire('a'), rl.tryAcquire('a'), rl.tryAcquire('a')]).toEqual([true, true, false])
    c.advance(999)
    expect(rl.tryAcquire('a')).toBe(false)
    c.advance(1)
    expect(rl.tryAcquire('a')).toBe(true)
  })

  it('o Map nunca passa de maxKeys: chave nova despeja a mais antiga', () => {
    const c = clock()
    const rl = createIpBurstLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: c.now })
    expect(rl.tryAcquire('a')).toBe(true)
    expect(rl.tryAcquire('b')).toBe(true)
    expect(rl.tryAcquire('c')).toBe(true) // despeja `a`
    expect(rl.tryAcquire('b')).toBe(false) // `b` segue na janela
    expect(rl.tryAcquire('a')).toBe(true) // `a` foi despejada: janela nova (e despeja `b`)
  })

  it('poda as janelas vencidas no máximo uma vez por janela, sem varrer a cada chamada', () => {
    const c = clock()
    const rl = createIpBurstLimiter({ max: 1, windowMs: 1000, now: c.now })
    rl.tryAcquire('a') // t=0: 1ª chamada poda (nada) e marca
    rl.tryAcquire('b')
    c.advance(500)
    rl.tryAcquire('c') // t=500: sem poda
    expect(rl.size()).toBe(3)
    c.advance(500)
    rl.tryAcquire('d') // t=1000: poda `a` e `b`; `c` ainda vale
    expect(rl.size()).toBe(2)
    c.advance(500)
    rl.tryAcquire('e') // t=1500: `c` venceu, mas a próxima poda só em t=2000
    expect(rl.size()).toBe(3)
    c.advance(500)
    rl.tryAcquire('f') // t=2000: poda `c` e `d`
    expect(rl.size()).toBe(2)
  })
})

describe('ipRateKey', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    [' 1.2.3.4 ', '1.2.3.4'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['[2001:db8::1]', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('%s ⇒ %s', (ip, key) => {
    expect(ipRateKey(ip)).toBe(key)
  })
})

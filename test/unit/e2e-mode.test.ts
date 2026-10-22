import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { e2eFakesActive, VERCEL_MARKERS } from '@/server/e2e/mode'
import { installLoopbackFetchGuard } from '@/server/e2e/fetch-guard'

/**
 * Guarda do MODO FAKE do E2E (#589). A flag `REFOGANDO_E2E_FAKES` troca TODOS os provedores externos por
 * dublês; um vazamento disso pra produção serviria receita enlatada e cadastro sem e-mail. Estes testes
 * travam: (1) a matriz da guarda (`e2eFakesActive`), (2) que os getters de `deps.ts` passam por ela,
 * (3) a invariante ESTRUTURAL de que todo `new Real*(` de deps.ts está atrás do ramo do modo fake, e (4)
 * o guarda de `fetch` do instrumentation.
 */

const HARNESS_ENV = {
  REFOGANDO_E2E_FAKES: '1',
  DATABASE_URL: 'postgres://postgres@localhost:5433/refogando_e2e_abc',
  BETTER_AUTH_URL: 'http://localhost:3100',
  APP_URL: 'http://localhost:3100',
}

describe('e2eFakesActive — matriz da guarda', () => {
  it('flag ausente ou vazia ⇒ false, sem ler mais nada (mesmo com Vercel e banco remoto)', () => {
    expect(e2eFakesActive({})).toBe(false)
    expect(e2eFakesActive({ REFOGANDO_E2E_FAKES: '' })).toBe(false)
    expect(
      e2eFakesActive({ VERCEL: '1', DATABASE_URL: 'postgres://u@ep-gentle-morning.neon.tech/db' }),
    ).toBe(false)
  })

  it('ambiente do harness (loopback, sem Vercel) ⇒ true', () => {
    expect(e2eFakesActive(HARNESS_ENV)).toBe(true)
    expect(e2eFakesActive({ ...HARNESS_ENV, DATABASE_URL: 'postgresql://p@127.0.0.1:5432/x' })).toBe(true)
    expect(e2eFakesActive({ ...HARNESS_ENV, DATABASE_URL: 'postgres://p@[::1]:5432/x' })).toBe(true)
  })

  it.each(['0', 'true', 'yes', ' 1', '1 '])('flag com valor %j ⇒ lança', (v) => {
    expect(() => e2eFakesActive({ ...HARNESS_ENV, REFOGANDO_E2E_FAKES: v })).toThrow(/só aceita '1'/)
  })

  it.each(VERCEL_MARKERS)('marcador da Vercel %s não vazio ⇒ lança', (k) => {
    expect(() => e2eFakesActive({ ...HARNESS_ENV, [k]: '1' })).toThrow(/Vercel/)
  })

  it('marcador da Vercel VAZIO não conta (o harness zera as chaves dos .env*)', () => {
    expect(e2eFakesActive({ ...HARNESS_ENV, VERCEL: '', VERCEL_ENV: '', VERCEL_URL: '' })).toBe(true)
  })

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['inválida', 'não é url'],
    ['Neon', 'postgres://u:p@ep-gentle-morning-123.sa-east-1.aws.neon.tech/neondb?sslmode=require'],
    ['host que só começa com localhost', 'postgres://u@localhost.evil.com/x'],
    ['protocolo errado', 'http://localhost:5432/x'],
  ])('DATABASE_URL %s ⇒ lança', (_n, url) => {
    expect(() => e2eFakesActive({ ...HARNESS_ENV, DATABASE_URL: url })).toThrow(/DATABASE_URL/)
  })

  it.each(['BETTER_AUTH_URL', 'APP_URL'])('%s fora de http:// loopback ⇒ lança', (k) => {
    expect(() => e2eFakesActive({ ...HARNESS_ENV, [k]: undefined })).toThrow(k)
    expect(() => e2eFakesActive({ ...HARNESS_ENV, [k]: 'https://localhost:3100' })).toThrow(k)
    expect(() => e2eFakesActive({ ...HARNESS_ENV, [k]: 'https://refogando.com.br' })).toThrow(k)
  })
})

describe('deps.ts — getters passam pela guarda', () => {
  const KEYS = [...Object.keys(HARNESS_ENV), ...VERCEL_MARKERS]
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
    // Módulo NOVO a cada teste: os getters memoizam a instância preguiçosa no escopo do módulo.
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.resetModules()
  })

  it('sem a flag ⇒ provedores reais (nada muda)', async () => {
    const deps = await import('@/server/deps')
    expect(deps.getMailer().constructor.name).toBe('RealResendMailer')
    expect(deps.getEmbedder().constructor.name).toBe('RealEmbedder')
  })

  it('flag + ambiente do harness ⇒ dublês do E2E', async () => {
    Object.assign(process.env, HARNESS_ENV)
    const deps = await import('@/server/deps')
    const mailer = deps.getMailer()
    expect(mailer.constructor.name).toBe('FakeMailer')
    // Cadastro entra direto (sem confirmação de e-mail), como produção sem Resend.
    expect(mailer.canSendAccountEmail()).toBe(false)
    expect((await deps.getEmbedder().embed('arroz')).length).toBe(1536)
    expect(deps.getImageStore().constructor.name).toBe('FakeImageStore')
    expect(deps.getWebSearchProvider().constructor.name).toBe('FakeWebSearchProvider')
  })

  it('flag + VERCEL=1 ⇒ o getter LANÇA (nunca devolve dublê num deploy)', async () => {
    Object.assign(process.env, HARNESS_ENV, { VERCEL: '1' })
    const deps = await import('@/server/deps')
    expect(() => deps.getMailer()).toThrow(/Vercel/)
    expect(() => deps.getEmbedder()).toThrow(/Vercel/)
  })

  it('override setX() continua com precedência sobre o modo fake', async () => {
    Object.assign(process.env, HARNESS_ENV, { VERCEL: '1' })
    const deps = await import('@/server/deps')
    const { FakeMailer } = await import('@/server/mail/mailer')
    const injected = new FakeMailer()
    deps.setMailer(injected)
    expect(deps.getMailer()).toBe(injected)
    deps.resetDeps()
  })
})

describe('invariantes estruturais do modo fake', () => {
  const root = process.cwd()
  const read = (p: string) => readFileSync(join(root, p), 'utf8')

  function srcFiles(dir: string): string[] {
    return readdirSync(join(root, dir)).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(join(root, p)).isDirectory()) return srcFiles(p)
      return /\.(ts|tsx)$/.test(name) ? [p] : []
    })
  }

  it('todo `new Real*(` de deps.ts está num ramo `e2eFakesActive() ? e2eFakes.x() :`', () => {
    const src = read('src/server/deps.ts')
    const hits = [...src.matchAll(/new Real\w+\(/g)]
    expect(hits.length).toBeGreaterThanOrEqual(11)
    for (const hit of hits) {
      const before = src.slice(0, hit.index)
      const assign = before.lastIndexOf(' = ')
      const stmt = src.slice(assign, hit.index)
      expect(stmt, `sem ramo do modo fake antes de ${hit[0]}`).toMatch(
        /^ = e2eFakesActive\(\)\s*\?\s*e2eFakes\.\w+\(\)\s*:\s*$/,
      )
    }
  })

  it('nenhum `new Real*(` fora de deps.ts (todo provedor real nasce na raiz de composição)', () => {
    const offenders = srcFiles('src')
      .filter((f) => !f.endsWith(join('server', 'deps.ts')))
      .filter((f) => /new Real\w+\(/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('`new Anthropic(` só nos arquivos das classes Real; `@vercel/blob` só no image-store', () => {
    const files = srcFiles('src')
    const anthropic = files.filter((f) => /new Anthropic\(/.test(read(f))).map((f) => relative('src', f)).sort()
    expect(anthropic).toEqual(
      [
        'server/claude/client.ts',
        'server/claude/model-catalog.ts',
        'server/claude/model-probe.ts',
        'server/translation/translator.ts',
      ].map((p) => join(...p.split('/'))),
    )
    const blob = files.filter((f) => /from '@vercel\/blob/.test(read(f))).map((f) => relative('src', f))
    expect(blob).toEqual([join('server', 'images', 'image-store.ts')])
  })

  it('fakes.ts não importa nada de test/ (vai pro bundle de produção)', () => {
    expect(read('src/server/e2e/fakes.ts')).not.toMatch(/from ['"][^'"]*test\//)
  })
})

describe('installLoopbackFetchGuard', () => {
  let original: typeof fetch

  beforeEach(() => {
    original = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = original
  })

  it('recusa http(s) fora de loopback e deixa loopback passar', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input))
      return new Response('ok')
    }) as typeof fetch
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    installLoopbackFetchGuard()
    installLoopbackFetchGuard() // idempotente: não embrulha duas vezes

    await expect(fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow(/api\.anthropic\.com/)
    await expect(fetch(new URL('https://api.resend.com/emails'))).rejects.toThrow(/resend/)
    await expect(fetch(new Request('https://localhost.evil.com/x'))).rejects.toThrow(/evil/)
    expect(await (await fetch('http://localhost:3100/api/health')).text()).toBe('ok')
    expect(await (await fetch('http://127.0.0.1:3100/x')).text()).toBe('ok')
    expect(calls).toEqual(['http://localhost:3100/api/health', 'http://127.0.0.1:3100/x'])
    expect(err).toHaveBeenCalledTimes(3)
    err.mockRestore()
  })
})

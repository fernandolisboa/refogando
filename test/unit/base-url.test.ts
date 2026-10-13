import { describe, it, expect, afterEach, vi } from 'vitest'
import { getBaseUrlFromEnv } from '@/server/http/base-url'

/**
 * Precedência de origem da base absoluta (metadataBase/canonical/OG). Regressão do bug em que, sem
 * `APP_URL`, a base caía no `VERCEL_URL` (deploy *.vercel.app), que está atrás do Vercel
 * Authentication — em produção a base tem de ser o domínio público.
 */
describe('getBaseUrlFromEnv — precedência de origem', () => {
  const snapshot = { ...process.env }
  afterEach(() => {
    process.env = { ...snapshot }
  })

  it('APP_URL tem precedência sobre tudo', () => {
    process.env.APP_URL = 'https://app.example'
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(getBaseUrlFromEnv()).toBe('https://app.example')
  })

  it('em PRODUÇÃO, prefere o domínio público (VERCEL_PROJECT_PRODUCTION_URL) ao deploy murado (VERCEL_URL)', () => {
    delete process.env.APP_URL
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(getBaseUrlFromEnv()).toBe('https://www.refogando.com')
  })

  it('fora de produção (preview), usa o VERCEL_URL do próprio deploy (não a PROD)', () => {
    delete process.env.APP_URL
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(getBaseUrlFromEnv()).toBe('https://refogando-xyz.vercel.app')
  })
})

/**
 * Variante BUILD-SAFE (#232/#235): a base do metadataBase/canonical/OG do detalhe PÚBLICO — env-only,
 * NUNCA `headers()` (senão a página vira dinâmica e perde a cacheabilidade do caminho indexável).
 */
describe('getBaseUrlFromEnv — env-only, sem headers()', () => {
  const snapshot = { ...process.env }
  afterEach(() => {
    process.env = { ...snapshot }
  })

  it('respeita a mesma precedência APP_URL → domínio público de PROD → VERCEL_URL', () => {
    process.env.APP_URL = 'https://app.example'
    expect(getBaseUrlFromEnv()).toBe('https://app.example')
    delete process.env.APP_URL
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(getBaseUrlFromEnv()).toBe('https://www.refogando.com')
  })

  it('em DEV sem env, cai num default estável de localhost (sem tocar headers)', () => {
    delete process.env.APP_URL
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
    // NODE_ENV é read-only no tipo de env; vi.stubEnv contorna sem `as`.
    vi.stubEnv('NODE_ENV', 'development')
    expect(getBaseUrlFromEnv()).toBe('http://localhost:3000')
    vi.unstubAllEnvs()
  })
})

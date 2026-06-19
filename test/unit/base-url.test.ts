import { describe, it, expect, afterEach, vi } from 'vitest'

// base-url importa `next/headers`; mockamos pra o import resolver no projeto `node` (sem Next).
// Os ramos testados (env presente) nem chegam a chamar `headers()`.
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }))

import { getBaseUrl } from '@/server/http/base-url'

/**
 * Precedência de origem do self-fetch server-side. Regressão do bug em que o detalhe da Receita
 * dava "Algo deu errado" em produção: sem `APP_URL`, caía no `VERCEL_URL` (deploy *.vercel.app),
 * que está atrás do Vercel Authentication — o self-fetch batia no muro (401) em vez da rota.
 */
describe('getBaseUrl — precedência de origem', () => {
  const snapshot = { ...process.env }
  afterEach(() => {
    process.env = { ...snapshot }
  })

  it('APP_URL tem precedência sobre tudo', async () => {
    process.env.APP_URL = 'https://app.example'
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(await getBaseUrl()).toBe('https://app.example')
  })

  it('em PRODUÇÃO, prefere o domínio público (VERCEL_PROJECT_PRODUCTION_URL) ao deploy murado (VERCEL_URL)', async () => {
    delete process.env.APP_URL
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(await getBaseUrl()).toBe('https://www.refogando.com')
  })

  it('fora de produção (preview), usa o VERCEL_URL do próprio deploy (não a PROD)', async () => {
    delete process.env.APP_URL
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.refogando.com'
    process.env.VERCEL_URL = 'refogando-xyz.vercel.app'
    expect(await getBaseUrl()).toBe('https://refogando-xyz.vercel.app')
  })
})

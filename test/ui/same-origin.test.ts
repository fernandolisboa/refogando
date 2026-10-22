/**
 * Guarda de mesma origem por `Sec-Fetch-Site` (#595, `src/server/http/same-origin.ts`). Pura (só lê o
 * cabeçalho): roda no projeto "ui", sem banco. A ligação com `POST /api/me/erasure` é testada na
 * integração (`me-erasure-origin.test.ts`).
 */
import { describe, it, expect } from 'vitest'
import { crossSiteForbidden, isCrossSiteRequest } from '@/server/http/same-origin'

function req(site?: string): Request {
  return new Request('http://localhost/api/me/erasure', {
    method: 'POST',
    headers: site === undefined ? {} : { 'sec-fetch-site': site },
  })
}

describe('isCrossSiteRequest', () => {
  it('sem o cabeçalho (curl, testes, navegador antigo) não bloqueia: vale o SameSite=Lax', () => {
    expect(isCrossSiteRequest(req())).toBe(false)
  })

  it('same-origin passa; cross-site e same-site (subdomínio) bloqueiam', () => {
    expect(isCrossSiteRequest(req('same-origin'))).toBe(false)
    expect(isCrossSiteRequest(req('cross-site'))).toBe(true)
    expect(isCrossSiteRequest(req('same-site'))).toBe(true)
  })

  it('none (endereço digitado) bloqueia por padrão, mas passa quando a rota o permite', () => {
    expect(isCrossSiteRequest(req('none'))).toBe(true)
    expect(isCrossSiteRequest(req('none'), ['same-origin', 'none'])).toBe(false)
    expect(isCrossSiteRequest(req('cross-site'), ['same-origin', 'none'])).toBe(true)
  })

  it('ignora caixa e espaços em volta', () => {
    expect(isCrossSiteRequest(req('  Same-Origin '))).toBe(false)
    expect(isCrossSiteRequest(req('CROSS-SITE'))).toBe(true)
  })
})

describe('crossSiteForbidden', () => {
  it('403 origem_nao_permitida, nunca cacheado', async () => {
    const res = crossSiteForbidden()
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ error: 'origem_nao_permitida' })
  })
})

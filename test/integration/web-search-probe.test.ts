import { describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/web-search/probe/route'
import { seedSessionHeaders } from '../helpers/users'
import { setRecipeProbe } from '@/server/deps'
import { FakeRecipeProbe, type RecipeProbe } from '@/server/import/recipe-probe'
import type { ProbeReport } from '@/domain/web-search-probe'

/**
 * Probe de saúde (#273) — POST admin-only (espelha /api/admin/config). Prova: Usuário/Curador → 403, sem
 * sessão → 401; Admin com o seam injetado → 200 com o ProbeReport; URL inválida/privada → 400 SEM tocar o
 * seam (barreira de SSRF antes da rede); seam que LANÇA → status ≠ 500 e corpo sem stack ("NUNCA 500").
 */

function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/web-search/probe', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('/api/admin/web-search/probe — gating (admin-only)', () => {
  it('Usuário → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'probe-user@273.test', role: 'usuario' })
    expect((await post({ url: 'https://exemplo.com/r' }, headers)).status).toBe(403)
  })

  it('Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'probe-cur@273.test', role: 'curador' })
    expect((await post({ url: 'https://exemplo.com/r' }, headers)).status).toBe(403)
  })

  it('sem sessão → 401', async () => {
    const res = await post({ url: 'https://exemplo.com/r' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })
})

describe('/api/admin/web-search/probe — veredito (admin, seam injetado)', () => {
  const cases: ProbeReport[] = [
    { fetched: true, jsonLd: 'present', robotsAllowed: true },
    { fetched: true, jsonLd: 'present', robotsAllowed: false },
    { fetched: true, jsonLd: 'present_unsupported_locale', robotsAllowed: true },
    { fetched: true, jsonLd: 'absent', robotsAllowed: true },
    { fetched: false, jsonLd: 'absent', robotsAllowed: true },
  ]

  it.each(cases)('Admin → 200 e ecoa o ProbeReport %o', async (report) => {
    const { headers } = await seedSessionHeaders({
      email: `probe-ok-${report.jsonLd}-${report.fetched}-${report.robotsAllowed}@273.test`,
      role: 'admin',
    })
    setRecipeProbe(new FakeRecipeProbe(report))
    const res = await post({ url: 'https://exemplo.com/receita' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(report)
  })
})

describe('/api/admin/web-search/probe — barreira de SSRF (400 antes do seam)', () => {
  it.each([
    'http://127.0.0.1/x',
    'http://169.254.169.254/latest',
    'http://localhost/x',
    'ftp://exemplo.com/x',
    'isto não é url',
  ])('URL inválida/privada (%s) → 400 url_invalida e o seam NÃO é chamado', async (badUrl) => {
    const { headers } = await seedSessionHeaders({
      email: `probe-bad-${encodeURIComponent(badUrl)}@273.test`,
      role: 'admin',
    })
    const probeSpy = vi.fn(async () => ({ fetched: true, jsonLd: 'present', robotsAllowed: true }) as ProbeReport)
    const spyProbe: RecipeProbe = { probe: probeSpy }
    setRecipeProbe(spyProbe)

    const res = await post({ url: badUrl }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'url_invalida' })
    expect(probeSpy).not.toHaveBeenCalled() // barreira roda ANTES da rede
  })
})

describe('/api/admin/web-search/probe — contrato NUNCA 500', () => {
  it('seam que LANÇA → status ≠ 500 e corpo sem stack', async () => {
    const { headers } = await seedSessionHeaders({ email: 'probe-throw@273.test', role: 'admin' })
    const throwing: RecipeProbe = {
      probe: async () => {
        throw new Error('boom interno secreto')
      },
    }
    setRecipeProbe(throwing)

    const res = await post({ url: 'https://exemplo.com/receita' }, headers)
    expect(res.status).not.toBe(500)
    const text = await res.text()
    expect(text).not.toContain('boom interno secreto')
    expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/) // sem stack-trace
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config do AVISO de catálogo AI-assistido (#237, SEO #187) — teste de COMPONENTE jsdom (seam #54):
 * `fetch` mockado no shape REAL de `GET/PUT /api/admin/config`. Cobre: carrega e reflete enabled +
 * texto; salvar envia SÓ o eixo `catalogDisclosure`; erro do servidor (config_invalida) mapeia a
 * mensagem `catalogoAvisoErroConfig`. Espelha `web-search-config-section.test.tsx`.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CatalogDisclosureConfigSection } from '@/components/admin/catalog-disclosure-config-section'

const A = ptBR.admin

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }
function mockFetch(routes: Record<string, FetchResult | FetchResult[]>) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: args[1]?.body })
    const entry = routes[`${method} ${url}`]
    if (entry === undefined) throw new Error(`fetch não mockado: ${method} ${url}`)
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function configBody(enabled: boolean, text: string) {
  return {
    defaultModel: 'claude-opus-4-8',
    imageGen: { enabled: true, model: 'gemini-3.1-flash-image', dailyCapByRole: { usuario: 3, curador: 5, admin: null } },
    recipeGenCapByRole: { usuario: 10, curador: 20, admin: null },
    webSearch: { enabled: false, allowlist: [] },
    catalogDisclosure: { enabled, text },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CatalogDisclosureConfigSection />
    </LocaleProvider>,
  )
}

describe('CatalogDisclosureConfigSection (#237)', () => {
  it('carrega e reflete enabled + texto', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(true, 'Curadoria + IA.') },
    })
    renderSection()

    const checkbox = await screen.findByRole('checkbox', { name: A.catalogoAvisoHabilitadoLabel })
    await waitFor(() => expect(checkbox).toBeChecked())
    const textarea = screen.getByLabelText(A.catalogoAvisoTextoLabel) as HTMLTextAreaElement
    expect(textarea.value).toBe('Curadoria + IA.')
  })

  it('salvar envia SÓ o eixo catalogDisclosure com { enabled, text }', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, 'Texto inicial.') },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody(true, 'Texto inicial. novo') },
    })
    const user = userEvent.setup()
    renderSection()

    const checkbox = await screen.findByRole('checkbox', { name: A.catalogoAvisoHabilitadoLabel })
    await user.click(checkbox) // liga
    const textarea = screen.getByLabelText(A.catalogoAvisoTextoLabel)
    await user.type(textarea, ' novo')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await screen.findByText(A.salvo)
    const put = calls.find((c) => c.method === 'PUT')!
    const sent = JSON.parse(String(put.body)) as { catalogDisclosure: { enabled: boolean; text: string } }
    // SÓ o eixo catalogDisclosure é enviado (nada de imageGen/webSearch/defaultModel).
    expect(Object.keys(sent)).toEqual(['catalogDisclosure'])
    expect(sent.catalogDisclosure.enabled).toBe(true)
    expect(sent.catalogDisclosure.text).toBe('Texto inicial. novo')
  })

  it('erro config_invalida do servidor mapeia para catalogoAvisoErroConfig', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(true, 'Algo') },
      'PUT /api/admin/config': { ok: false, status: 400, body: { error: 'config_invalida' } },
    })
    const user = userEvent.setup()
    renderSection()

    await screen.findByRole('checkbox', { name: A.catalogoAvisoHabilitadoLabel })
    await user.click(screen.getByRole('button', { name: A.salvar }))

    expect(await screen.findByText(A.catalogoAvisoErroConfig)).toBeInTheDocument()
  })
})

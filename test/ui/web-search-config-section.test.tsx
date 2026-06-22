import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config da DESCOBERTA na web (#164, ADR-0019) — teste de COMPONENTE jsdom (seam #54): `fetch` mockado
 * no shape REAL de `GET/PUT /api/admin/config`. Cobre: carrega e reflete enabled + allowlist (uma linha
 * por domínio); salvar envia SÓ o eixo `webSearch` com `{ enabled, allowlist: string[] }`; erro do
 * servidor (config_invalida) mapeia a mensagem `webErroConfig`.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { WebSearchConfigSection } from '@/components/admin/web-search-config-section'

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

function configBody(enabled: boolean, allowlist: string[]) {
  return {
    defaultModel: 'claude-opus-4-8',
    imageGen: { enabled: true, model: 'gemini-3.1-flash-image', dailyCapByRole: { usuario: 3, curador: 5, admin: null } },
    recipeGenCapByRole: { usuario: 10, curador: 20, admin: null },
    webSearch: { enabled, allowlist },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <WebSearchConfigSection />
    </LocaleProvider>,
  )
}

describe('WebSearchConfigSection (#164)', () => {
  it('carrega e reflete enabled + allowlist (uma linha por domínio)', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(true, ['tudogostoso.com.br', 'panelinha.com.br']) },
    })
    renderSection()

    // O checkbox reflete `enabled` e a textarea traz os domínios, um por linha.
    const checkbox = await screen.findByRole('checkbox', { name: A.webHabilitadaLabel })
    await waitFor(() => expect(checkbox).toBeChecked())
    const textarea = screen.getByLabelText(A.webAllowlistLabel) as HTMLTextAreaElement
    expect(textarea.value).toBe('tudogostoso.com.br\npanelinha.com.br')
  })

  it('salvar envia SÓ o eixo webSearch com { enabled, allowlist: string[] }', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, []) },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody(true, ['a.com', 'b.com']) },
    })
    const user = userEvent.setup()
    renderSection()

    const checkbox = await screen.findByRole('checkbox', { name: A.webHabilitadaLabel })
    await user.click(checkbox) // liga
    const textarea = screen.getByLabelText(A.webAllowlistLabel)
    await user.type(textarea, 'a.com\nb.com')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await screen.findByText(A.salvo)
    const put = calls.find((c) => c.method === 'PUT')!
    const sent = JSON.parse(String(put.body)) as { webSearch: { enabled: boolean; allowlist: string[] } }
    // SÓ o eixo webSearch é enviado (nada de imageGen/defaultModel).
    expect(Object.keys(sent)).toEqual(['webSearch'])
    expect(sent.webSearch.enabled).toBe(true)
    expect(sent.webSearch.allowlist).toEqual(['a.com', 'b.com']) // linhas → string[]
  })

  it('erro config_invalida do servidor mapeia para webErroConfig', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, []) },
      'PUT /api/admin/config': { ok: false, status: 400, body: { error: 'config_invalida' } },
    })
    const user = userEvent.setup()
    renderSection()

    const textarea = await screen.findByLabelText(A.webAllowlistLabel)
    await user.type(textarea, 'isto não é um domínio')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    expect(await screen.findByText(A.webErroConfig)).toBeInTheDocument()
  })

  it('descarta linhas vazias da allowlist antes de enviar', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(true, []) },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody(true, ['a.com']) },
    })
    const user = userEvent.setup()
    renderSection()

    const textarea = await screen.findByLabelText(A.webAllowlistLabel)
    await user.type(textarea, 'a.com\n\n  \n')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await screen.findByText(A.salvo)
    const put = calls.find((c) => c.method === 'PUT')!
    const sent = JSON.parse(String(put.body)) as { webSearch: { allowlist: string[] } }
    expect(sent.webSearch.allowlist).toEqual(['a.com'])
  })
})

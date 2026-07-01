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
import type { ProbeReport } from '@/domain/web-search-probe'

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

// ── #273: domínios sugeridos (click-to-add) ───────────────────────────────────────
describe('WebSearchConfigSection — domínios sugeridos (#273)', () => {
  it('clicar num sugerido acrescenta ao textarea e desabilita o chip (dedup)', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, []) },
    })
    const user = userEvent.setup()
    renderSection()

    const chip = await screen.findByRole('button', {
      name: A.webSugeridoAdicionarAria.replace('{dominio}', 'tudogostoso.com.br'),
    })
    expect(chip).toBeEnabled()
    await user.click(chip)

    const textarea = screen.getByLabelText(A.webAllowlistLabel) as HTMLTextAreaElement
    expect(textarea.value).toBe('tudogostoso.com.br')
    // após o clique, o chip vira "já na lista" e fica desabilitado (dedup).
    const present = screen.getByRole('button', { name: /tudogostoso\.com\.br/ })
    expect(present).toBeDisabled()
  })

  it('chip de domínio já presente na allowlist nasce desabilitado', async () => {
    mockFetch({
      'GET /api/admin/config': {
        ok: true,
        status: 200,
        body: configBody(true, ['tudogostoso.com.br']),
      },
    })
    renderSection()

    const present = await screen.findByRole('button', { name: /tudogostoso\.com\.br/ })
    expect(present).toBeDisabled()
    // um sugerido AUSENTE segue habilitado.
    expect(
      screen.getByRole('button', {
        name: A.webSugeridoAdicionarAria.replace('{dominio}', 'cybercook.com.br'),
      }),
    ).toBeEnabled()
  })

  it('clicar num sugerido NÃO dispara save (PUT) — sugerir ≠ vetar', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, []) },
    })
    const user = userEvent.setup()
    renderSection()

    const chip = await screen.findByRole('button', {
      name: A.webSugeridoAdicionarAria.replace('{dominio}', 'allrecipes.com'),
    })
    await user.click(chip)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

// ── #273: probe de saúde (JSON-LD + robots) ───────────────────────────────────────
describe('WebSearchConfigSection — probe de saúde (#273)', () => {
  const PROBE_URL = '/api/admin/web-search/probe'

  async function runProbe(probeEntry: FetchResult) {
    const mocks = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody(false, []) },
      [`POST ${PROBE_URL}`]: probeEntry,
    })
    const user = userEvent.setup()
    renderSection()
    const input = await screen.findByLabelText(A.webProbeUrlLabel)
    await user.type(input, 'https://site.com/receita')
    await user.click(screen.getByRole('button', { name: A.webProbeChecar }))
    return mocks
  }

  it('veredito VERDE: fetched + JSON-LD presente + robots permite → importável', async () => {
    await runProbe({
      ok: true,
      status: 200,
      body: { fetched: true, jsonLd: 'present', robotsAllowed: true },
    })
    expect(await screen.findByText(A.webProbeImportavel)).toBeInTheDocument()
    expect(screen.getByText(A.webProbeJsonLdSim)).toBeInTheDocument()
    expect(screen.getByText(A.webProbeRobotsPermite)).toBeInTheDocument()
  })

  it('robots BLOQUEIA → não importável', async () => {
    await runProbe({
      ok: true,
      status: 200,
      body: { fetched: true, jsonLd: 'present', robotsAllowed: false },
    })
    expect(await screen.findByText(A.webProbeNaoImportavel)).toBeInTheDocument()
    expect(screen.getByText(A.webProbeRobotsBloqueia)).toBeInTheDocument()
  })

  it('idioma não suportado → mostra a 3ª variante do JSON-LD e não importável', async () => {
    await runProbe({
      ok: true,
      status: 200,
      body: { fetched: true, jsonLd: 'present_unsupported_locale', robotsAllowed: true },
    })
    expect(await screen.findByText(A.webProbeJsonLdIdiomaNaoSuportado)).toBeInTheDocument()
    expect(screen.getByText(A.webProbeNaoImportavel)).toBeInTheDocument()
  })

  it('fetched:false → mostra SÓ "não carregou" (suprime linhas por-sinal)', async () => {
    await runProbe({
      ok: true,
      status: 200,
      body: { fetched: false, jsonLd: 'absent', robotsAllowed: true },
    })
    expect(await screen.findByText(A.webProbeNaoCarregou)).toBeInTheDocument()
    expect(screen.queryByText(A.webProbeJsonLdNao)).not.toBeInTheDocument()
    expect(screen.queryByText(A.webProbeRobotsPermite)).not.toBeInTheDocument()
  })

  it('400 url_invalida do servidor → label de URL inválida', async () => {
    await runProbe({ ok: false, status: 400, body: { error: 'url_invalida' } })
    expect(await screen.findByText(A.webProbeUrlInvalida)).toBeInTheDocument()
  })

  it('erro de rede → label de erro genérico do probe', async () => {
    await runProbe({ reject: true })
    expect(await screen.findByText(A.webProbeErro)).toBeInTheDocument()
  })

  it('descarta veredito OBSOLETO: se a URL muda antes de a resposta voltar, NÃO pinta o resultado', async () => {
    // Probe pendente controlável: só resolve quando chamarmos resolveProbe — assim mudamos a URL no meio do voo.
    let resolveProbe!: (report: ProbeReport) => void
    const pending = new Promise<ProbeReport>((r) => {
      resolveProbe = r
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        const url = String(args[0])
        const method = (args[1]?.method ?? 'GET').toUpperCase()
        if (method === 'GET' && url === '/api/admin/config') {
          return { ok: true, status: 200, json: async () => configBody(false, []) } as Response
        }
        if (method === 'POST' && url === PROBE_URL) {
          const report = await pending
          return { ok: true, status: 200, json: async () => report } as Response
        }
        throw new Error(`fetch não mockado: ${method} ${url}`)
      }),
    )

    const user = userEvent.setup()
    renderSection()
    const input = await screen.findByLabelText(A.webProbeUrlLabel)
    await user.type(input, 'https://site-a.com/receita')
    await user.click(screen.getByRole('button', { name: A.webProbeChecar }))

    // a URL muda ENQUANTO o probe da URL-A ainda está no ar (sequence-guard deve invalidá-lo)
    await user.type(input, 'X')

    // agora a resposta (da URL-A) finalmente volta — deve ser DESCARTADA, não pintada
    resolveProbe({ fetched: true, jsonLd: 'present', robotsAllowed: true })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByText(A.webProbeImportavel)).not.toBeInTheDocument()
    expect(screen.queryByText(A.webProbeJsonLdSim)).not.toBeInTheDocument()
  })
})

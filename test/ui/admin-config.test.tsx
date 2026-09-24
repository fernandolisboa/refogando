import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config de modelo (#63, AC1). Teste de COMPONENTE jsdom (seam #54): `fetch` mockado no shape REAL
 * das rotas `GET/PUT /api/admin/config` e `GET /api/admin/models`. Cobre: carga do valor + opções,
 * modelo salvo fora da lista atual, salvar com sucesso, erro específico
 * (`modelo_invalido`), erro GENÉRICO (500 `erro_interno`) e erro de CARGA + retry.
 *
 * As asserções da RolesSection vivem em `roles-section.test.tsx` (#269 trocou o "cole o UUID" por
 * busca → selecionar → atribuir; o componente ficou grande demais pra dividir o arquivo).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ConfigSection } from '@/components/admin/config-section'

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

/** Router de fetch por (url, method) → resposta. Cada chave pode ter fila de respostas. */
function mockFetch(routes: Record<string, FetchResult | FetchResult[]>) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const entry = routes[key]
    if (entry === undefined) throw new Error(`fetch não mockado: ${key}`)
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const A = ptBR.admin

// Opções como `GET /api/admin/models` devolve (o mais novo de cada família).
const MODELS_OK: FetchResult = {
  ok: true,
  status: 200,
  body: {
    models: [
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', family: 'opus' },
      { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', family: 'sonnet' },
      { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', family: 'fable' },
    ],
  },
}

function renderConfig() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ConfigSection />
    </LocaleProvider>,
  )
}

describe('ConfigSection (#63 AC1)', () => {
  it('carrega o valor atual no select', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-5-5' } },
    })
    renderConfig()
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('claude-opus-5-5')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Claude Opus 5.5',
      'Claude Sonnet 5',
      'Claude Fable 5.1',
    ])
  })

  it('modelo salvo fora da lista atual aparece marcado (o select não mente sobre o que está em uso)', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-4-8' } },
    })
    renderConfig()
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('claude-opus-4-8')
    expect(select.options[0].textContent).toBe(`claude-opus-4-8 (${A.modeloForaDaLista})`)
    expect(select.options).toHaveLength(4)
  })

  it('salva o modelo escolhido (PUT com body correto) → status de sucesso', async () => {
    const fetchMock = mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-5-5' } },
      'PUT /api/admin/config': {
        ok: true,
        status: 200,
        body: { defaultModel: 'claude-sonnet-5' },
      },
    })
    const user = userEvent.setup()
    renderConfig()
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    await user.selectOptions(select, 'claude-sonnet-5')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    const put = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'PUT')!
    expect(String(put[0])).toBe('/api/admin/config')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      defaultModel: 'claude-sonnet-5',
    })
    expect(await screen.findByText(A.salvo)).toBeInTheDocument()
  })

  it('modelo inválido (400 modelo_invalido) → mensagem específica', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-5-5' } },
      'PUT /api/admin/config': { ok: false, status: 400, body: { error: 'modelo_invalido' } },
    })
    const user = userEvent.setup()
    renderConfig()
    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: A.salvar }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(A.erroModelo)
  })

  it('500 erro_interno → mensagem GENÉRICA (não-ok != modelo_invalido)', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-5-5' } },
      'PUT /api/admin/config': { ok: false, status: 500, body: { error: 'erro_interno' } },
    })
    const user = userEvent.setup()
    renderConfig()
    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: A.salvar }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(A.erroGenerico)
    expect(alert).not.toHaveTextContent(A.erroModelo)
  })

  it('erro de CARGA → alert + retry; retry → segundo GET ok exibe o select', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: { defaultModel: 'claude-sonnet-5' } },
      ],
    })
    const user = userEvent.setup()
    renderConfig()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ptBR.system.error)
    expect(screen.queryByRole('combobox')).toBeNull()

    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('claude-sonnet-5')
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config de modelo + Papéis (#63, AC1). Teste de COMPONENTE jsdom (seam #54): `fetch`
 * mockado no shape REAL das rotas `GET/PUT /api/admin/config` e `PUT /api/admin/roles`.
 * Cobre: carga do valor, salvar com sucesso, erro específico (`modelo_invalido`), erro
 * GENÉRICO (500 `erro_interno` — prova que não-ok != chave conhecida cai no genérico),
 * erro de CARGA + retry, e a discriminação de erro de papéis pela CHAVE do corpo (não pelo
 * status): `papel_invalido` (400) e `papel_nao_aplicado` (testado em 404 E em 400).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ConfigSection } from '@/components/admin/config-section'
import { RolesSection } from '@/components/admin/roles-section'

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

function renderConfig() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ConfigSection />
    </LocaleProvider>,
  )
}
function renderRoles() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RolesSection />
    </LocaleProvider>,
  )
}

describe('ConfigSection (#63 AC1)', () => {
  it('carrega o valor atual no select', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-4-8' } },
    })
    renderConfig()
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('claude-opus-4-8')
  })

  it('salva o modelo escolhido (PUT com body correto) → status de sucesso', async () => {
    const fetchMock = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-4-8' } },
      'PUT /api/admin/config': {
        ok: true,
        status: 200,
        body: { defaultModel: 'claude-sonnet-4-6' },
      },
    })
    const user = userEvent.setup()
    renderConfig()
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    await user.selectOptions(select, 'claude-sonnet-4-6')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    const put = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'PUT')!
    expect(String(put[0])).toBe('/api/admin/config')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      defaultModel: 'claude-sonnet-4-6',
    })
    expect(await screen.findByText(A.salvo)).toBeInTheDocument()
  })

  it('modelo inválido (400 modelo_invalido) → mensagem específica', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-4-8' } },
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
      'GET /api/admin/config': { ok: true, status: 200, body: { defaultModel: 'claude-opus-4-8' } },
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
      'GET /api/admin/config': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: { defaultModel: 'claude-sonnet-4-6' } },
      ],
    })
    const user = userEvent.setup()
    renderConfig()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ptBR.system.error)
    expect(screen.queryByRole('combobox')).toBeNull()

    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('claude-sonnet-4-6')
  })
})

describe('RolesSection (#63 AC1) — discriminação de erro por CHAVE do corpo', () => {
  it('promove (PUT com body correto) → status de sucesso', async () => {
    const fetchMock = mockFetch({
      'PUT /api/admin/roles': { ok: true, status: 200, body: { userId: 'u1', role: 'curador' } },
    })
    const user = userEvent.setup()
    renderRoles()
    await user.type(screen.getByLabelText(A.userIdLabel), 'u1')
    await user.selectOptions(screen.getByLabelText(A.papelLabel), 'curador')
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))

    const put = fetchMock.mock.calls[0]
    expect(String(put[0])).toBe('/api/admin/roles')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      userId: 'u1',
      role: 'curador',
    })
    expect(await screen.findByText(A.promovido)).toBeInTheDocument()
  })

  it('papel_invalido (400) → mensagem de papel inválido', async () => {
    mockFetch({
      'PUT /api/admin/roles': { ok: false, status: 400, body: { error: 'papel_invalido' } },
    })
    const user = userEvent.setup()
    renderRoles()
    await user.type(screen.getByLabelText(A.userIdLabel), 'u1')
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    expect(await screen.findByRole('alert')).toHaveTextContent(A.erroPapelInvalido)
  })

  it('papel_nao_aplicado em 404 → "Não foi possível aplicar o papel"', async () => {
    mockFetch({
      'PUT /api/admin/roles': { ok: false, status: 404, body: { error: 'papel_nao_aplicado' } },
    })
    const user = userEvent.setup()
    renderRoles()
    await user.type(screen.getByLabelText(A.userIdLabel), 'u1')
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    expect(await screen.findByRole('alert')).toHaveTextContent(A.erroNaoAplicado)
  })

  it('papel_nao_aplicado em 400 → MESMA mensagem (discrimina por CHAVE, não por status)', async () => {
    mockFetch({
      'PUT /api/admin/roles': { ok: false, status: 400, body: { error: 'papel_nao_aplicado' } },
    })
    const user = userEvent.setup()
    renderRoles()
    await user.type(screen.getByLabelText(A.userIdLabel), 'u1')
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(A.erroNaoAplicado)
    expect(alert).not.toHaveTextContent(A.erroPapelInvalido)
  })

  it('botão desabilitado com userId vazio', () => {
    mockFetch({})
    renderRoles()
    expect(screen.getByRole('button', { name: A.aplicarPapel })).toBeDisabled()
  })
})

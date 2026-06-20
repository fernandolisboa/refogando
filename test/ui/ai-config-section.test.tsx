import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config da geração de imagem por IA (#134) — teste de COMPONENTE jsdom (seam #54): `fetch` mockado
 * no shape REAL de `GET/PUT /api/admin/config`. Cobre: carrega e reflete enabled/modelo/tetos; salvar
 * envia o eixo `imageGen` com os valores certos; teto inválido (negativo) bloqueia no CLIENTE (sem
 * PUT); erro do servidor (config_invalida / 500) mapeia a mensagem. NÃO mocka next/navigation
 * (a seção não navega — se alguém adicionar router, o jsdom lança e o teste pega).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { DEFAULT_IMAGE_MODEL } from '@/domain/image-gen-config'
import { AiConfigSection } from '@/components/admin/ai-config-section'

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

function configBody(over: Partial<{ enabled: boolean; usuario: number | null; curador: number | null; admin: number | null }> = {}) {
  return {
    defaultModel: 'claude-opus-4-8',
    imageGen: {
      enabled: over.enabled ?? true,
      model: DEFAULT_IMAGE_MODEL,
      dailyCapByRole: {
        usuario: over.usuario ?? 3,
        curador: over.curador ?? 5,
        admin: over.admin ?? null,
      },
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <AiConfigSection />
    </LocaleProvider>,
  )
}

describe('AiConfigSection (#134)', () => {
  it('carrega e reflete enabled/modelo/tetos da config', async () => {
    mockFetch({ 'GET /api/admin/config': { ok: true, status: 200, body: configBody() } })
    renderSection()

    const enabled = (await screen.findByLabelText(A.aiHabilitadaLabel)) as HTMLInputElement
    expect(enabled.checked).toBe(true)
    expect((screen.getByLabelText(A.papelUsuario) as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText(A.papelCurador) as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText(A.papelAdmin) as HTMLInputElement).value).toBe('') // null ⇒ vazio (ilimitado)
  })

  it('salvar envia o eixo imageGen com os valores editados', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody({ enabled: false, usuario: 2 }) },
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByLabelText(A.aiHabilitadaLabel)) // desliga
    const usuario = screen.getByLabelText(A.papelUsuario)
    await user.clear(usuario)
    await user.type(usuario, '2')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body))).toEqual({
      imageGen: {
        enabled: false,
        model: DEFAULT_IMAGE_MODEL,
        dailyCapByRole: { usuario: 2, curador: 5, admin: null },
      },
    })
    expect(await screen.findByText(A.salvo)).toBeInTheDocument()
  })

  it('teto vazio é enviado como null (ilimitado)', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody() },
    })
    const user = userEvent.setup()
    renderSection()

    const usuario = await screen.findByLabelText(A.papelUsuario)
    await user.clear(usuario) // vazio ⇒ ilimitado
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body)).imageGen.dailyCapByRole.usuario).toBeNull()
  })

  it('teto inválido (negativo) bloqueia no CLIENTE: mostra erro e NÃO faz PUT', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
    })
    const user = userEvent.setup()
    renderSection()

    const usuario = await screen.findByLabelText(A.papelUsuario)
    fireEvent.change(usuario, { target: { value: '-1' } }) // programático: passa a guarda de min do browser
    await user.click(screen.getByRole('button', { name: A.salvar }))

    expect(await screen.findByText(A.aiErroConfig)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false) // nada enviado
  })

  it('servidor recusa (config_invalida) ⇒ mensagem específica', async () => {
    mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
      'PUT /api/admin/config': { ok: false, status: 400, body: { error: 'config_invalida' } },
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: A.salvar }))
    expect(await screen.findByText(A.aiErroConfig)).toBeInTheDocument()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok mostra os campos', async () => {
    mockFetch({
      'GET /api/admin/config': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: configBody() },
      ],
    })
    const user = userEvent.setup()
    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.system.error)
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByLabelText(A.aiHabilitadaLabel)).toBeInTheDocument()
  })
})

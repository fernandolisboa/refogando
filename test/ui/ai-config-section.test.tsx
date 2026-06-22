import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Config da geração por IA (#134 imagem + #167 teto de receita) — teste de COMPONENTE jsdom (seam
 * #54): `fetch` mockado no shape REAL de `GET/PUT /api/admin/config`. Cobre: carrega e reflete
 * enabled/modelo/tetos (imagem E receita); salvar envia AMBOS os eixos (imageGen + recipeGenCapByRole)
 * com os valores certos; teto inválido bloqueia no CLIENTE (sem PUT); erro do servidor mapeia a
 * mensagem. NÃO mocka next/navigation (a seção não navega — se alguém adicionar router, o jsdom lança).
 *
 * Os dois fieldsets de teto repetem os MESMOS rótulos de papel; as queries são escopadas por fieldset
 * (via legenda) com `within` pra não ficarem ambíguas.
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

function configBody(
  over: Partial<{
    enabled: boolean
    usuario: number | null
    curador: number | null
    admin: number | null
    recipeUsuario: number | null
    recipeCurador: number | null
    recipeAdmin: number | null
  }> = {},
) {
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
    recipeGenCapByRole: {
      usuario: over.recipeUsuario ?? 10,
      curador: over.recipeCurador ?? 20,
      admin: over.recipeAdmin ?? null,
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

/** Acha o <fieldset> que contém uma legenda dada (escopo pras queries de papel não ficarem ambíguas). */
function fieldsetByLegend(legend: string): HTMLElement {
  const leg = screen.getByText(legend)
  const fs = leg.closest('fieldset')
  if (!fs) throw new Error(`fieldset não encontrado para a legenda: ${legend}`)
  return fs as HTMLElement
}

describe('AiConfigSection (#134 + #167)', () => {
  it('carrega e reflete enabled/modelo/tetos de imagem E de receita', async () => {
    mockFetch({ 'GET /api/admin/config': { ok: true, status: 200, body: configBody() } })
    renderSection()

    const enabled = (await screen.findByLabelText(A.aiHabilitadaLabel)) as HTMLInputElement
    expect(enabled.checked).toBe(true)

    const img = within(fieldsetByLegend(A.aiTetosLabel))
    expect((img.getByLabelText(A.papelUsuario) as HTMLInputElement).value).toBe('3')
    expect((img.getByLabelText(A.papelCurador) as HTMLInputElement).value).toBe('5')
    expect((img.getByLabelText(A.papelAdmin) as HTMLInputElement).value).toBe('') // null ⇒ vazio

    const rec = within(fieldsetByLegend(A.aiTetoReceitaLabel))
    expect((rec.getByLabelText(A.papelUsuario) as HTMLInputElement).value).toBe('10')
    expect((rec.getByLabelText(A.papelCurador) as HTMLInputElement).value).toBe('20')
    expect((rec.getByLabelText(A.papelAdmin) as HTMLInputElement).value).toBe('') // null ⇒ vazio
  })

  it('salvar envia AMBOS os eixos (imageGen + recipeGenCapByRole) com os valores editados', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
      'PUT /api/admin/config': {
        ok: true,
        status: 200,
        body: configBody({ enabled: false, usuario: 2, recipeUsuario: 7 }),
      },
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByLabelText(A.aiHabilitadaLabel)) // desliga
    const imgUsuario = within(fieldsetByLegend(A.aiTetosLabel)).getByLabelText(A.papelUsuario)
    await user.clear(imgUsuario)
    await user.type(imgUsuario, '2')
    const recUsuario = within(fieldsetByLegend(A.aiTetoReceitaLabel)).getByLabelText(A.papelUsuario)
    await user.clear(recUsuario)
    await user.type(recUsuario, '7')
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body))).toEqual({
      imageGen: {
        enabled: false,
        model: DEFAULT_IMAGE_MODEL,
        dailyCapByRole: { usuario: 2, curador: 5, admin: null },
      },
      recipeGenCapByRole: { usuario: 7, curador: 20, admin: null },
    })
    expect(await screen.findByText(A.salvo)).toBeInTheDocument()
  })

  it('teto de receita vazio é enviado como null (ilimitado)', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
      'PUT /api/admin/config': { ok: true, status: 200, body: configBody() },
    })
    const user = userEvent.setup()
    renderSection()

    await screen.findByLabelText(A.aiHabilitadaLabel) // espera a carga (sai do "Carregando…")
    const recUsuario = within(fieldsetByLegend(A.aiTetoReceitaLabel)).getByLabelText(A.papelUsuario)
    await user.clear(recUsuario) // vazio ⇒ ilimitado
    await user.click(screen.getByRole('button', { name: A.salvar }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body)).recipeGenCapByRole.usuario).toBeNull()
  })

  it('teto de receita inválido (negativo) bloqueia no CLIENTE: mostra erro e NÃO faz PUT', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: configBody() },
    })
    const user = userEvent.setup()
    renderSection()

    await screen.findByLabelText(A.aiHabilitadaLabel) // espera a carga (sai do "Carregando…")
    const recUsuario = within(fieldsetByLegend(A.aiTetoReceitaLabel)).getByLabelText(A.papelUsuario)
    fireEvent.change(recUsuario, { target: { value: '-1' } }) // programático: passa a guarda de min
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

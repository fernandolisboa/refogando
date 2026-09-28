import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do "Sugerir com IA" do Cardápio (`MealPlanSuggestPanel`, ADR-0036). Fluxo: o pedido vira
 * UM `POST /api/me/meal-plan/suggestions?locale` (nada é gravado), a prévia lista os itens com
 * checkbox, e "Adicionar" manda SÓ os marcados pra `.../suggestions/apply` com as porções do pedido.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { MealPlanSuggestPanel } from '@/components/meal-plan/meal-plan-suggest-panel'

const M = ptBR.cardapio
const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']

type FetchResult = { status: number; body: unknown }
type Call = { url: string; method: string; body: Record<string, unknown> | undefined }

const PREVIEW = {
  items: [
    { day: '2026-10-08', slot: 'jantar', motivo: 'Rápida pra quinta.', recipe: { id: 'r-1', name: 'Omelete', slug: 'omelete' } },
    { day: '2026-10-09', slot: 'jantar', motivo: 'Peixe na sexta.', recipe: { id: 'r-2', name: 'Moqueca' } },
  ],
  comentario: 'Semana leve.',
  targetCount: 3,
}

function mockFetch(opts: { suggest?: FetchResult; apply?: FetchResult } = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body != null ? JSON.parse(String(init.body)) : undefined })
      let r: FetchResult = { status: 404, body: {} }
      if (url.startsWith('/api/me/meal-plan/suggestions?')) r = opts.suggest ?? { status: 200, body: PREVIEW }
      else if (url === '/api/me/meal-plan/suggestions/apply') r = opts.apply ?? { status: 200, body: { addedCount: 1, skippedCount: 0 } }
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
    }),
  )
  return calls
}

function renderPanel(today: string, onApplied = vi.fn()) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanSuggestPanel days={DAYS} today={today} onApplied={onApplied} />
    </LocaleProvider>,
  )
  return onApplied
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('MealPlanSuggestPanel (ADR-0036)', () => {
  it('pedido padrão: de hoje em diante, almoço + jantar, 2 porções, comunidade incluída, só vazias', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderPanel('2026-10-08') // quinta
    await user.type(screen.getByRole('textbox', { name: M.sugerirNota }), 'peixe na sexta')
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/me/meal-plan/suggestions?locale=pt-BR')
    expect(calls[0].body).toEqual({
      days: ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
      slots: ['almoco', 'jantar'],
      porcoes: 2,
      restricoes: [],
      source: 'all',
      onlyEmpty: true,
      note: 'peixe na sexta',
    })
  })

  it('restrições e fonte entram no pedido; semana fora de hoje pede a semana inteira', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderPanel('2026-09-30')
    await user.click(screen.getByRole('checkbox', { name: ptBR.restricaoLabel.vegano }))
    await user.selectOptions(screen.getByRole('combobox', { name: M.sugerirFonte }), 'mine')
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toMatchObject({ days: DAYS, restricoes: ['vegano'], source: 'mine' })
  })

  it('prévia: mostra itens, motivo e aviso de parcial; aceita SÓ os marcados com as porções do pedido', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    const onApplied = renderPanel('2026-10-08')
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))

    expect(await screen.findByText('Omelete')).toBeInTheDocument()
    expect(screen.getByText('Peixe na sexta.')).toBeInTheDocument()
    expect(screen.getByText('Semana leve.')).toBeInTheDocument()
    expect(screen.getByText(M.sugestaoParcial.replace('{n}', '2').replace('{total}', '3'))).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Incluir Moqueca/ }))
    await user.click(screen.getByRole('button', { name: M.sugestaoAceitarSingular }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    const applyCall = calls.find((c) => c.url === '/api/me/meal-plan/suggestions/apply')!
    expect(applyCall.body).toEqual({ entries: [{ recipeId: 'r-1', day: '2026-10-08', slot: 'jantar', porcoes: 2 }] })
    expect(await screen.findByText(M.sugestaoAdicionadaSingular)).toBeInTheDocument()
  })

  it.each([
    ['limite_sugestao', { error: 'limite_sugestao', retryAfterMs: 2 * 3_600_000 }, M.erroSugestaoLimite.replace('{tempo}', '2 h')],
    ['sem_candidatas', { error: 'sem_candidatas' }, M.erroSugestaoSemCandidatas],
    ['nada_a_preencher', { error: 'nada_a_preencher' }, M.erroSugestaoNadaAPreencher],
    ['sugestao_falhou', { error: 'sugestao_falhou' }, M.erroSugestaoFalhou],
  ])('erro %s vira mensagem e o formulário volta', async (_code, body, message) => {
    const user = userEvent.setup()
    mockFetch({ suggest: { status: body.error === 'sugestao_falhou' ? 502 : body.error === 'limite_sugestao' ? 429 : 422, body } })
    renderPanel('2026-10-08')
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: M.sugerirEnviar })).toBeEnabled()
  })

  it('sem dia ou refeição marcados: avisa sem chamar a IA', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderPanel('2026-10-08')
    await user.click(screen.getByRole('checkbox', { name: M.slotAlmoco }))
    await user.click(screen.getByRole('checkbox', { name: M.slotJantar }))
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSugestaoDados)
    expect(calls).toHaveLength(0)
  })

  it('porções inválidas: avisa sem chamar a IA', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderPanel('2026-10-08')
    await user.clear(screen.getByRole('spinbutton', { name: M.sugerirPorcoes }))
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSugestaoPorcoes)
    expect(calls).toHaveLength(0)
  })

  it('lembra as porções escolhidas no navegador', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderPanel('2026-10-08')
    const input = screen.getByRole('spinbutton', { name: M.sugerirPorcoes })
    await user.clear(input)
    await user.type(input, '4')
    await user.click(screen.getByRole('button', { name: M.sugerirEnviar }))
    await screen.findByText('Omelete')
    expect(window.localStorage.getItem('refogando.cardapio.sugestao.porcoes')).toBe('4')
  })
})

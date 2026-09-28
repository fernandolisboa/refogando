import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do "Gerar lista de compras" do Cardápio (`MealPlanShoppingListPanel`, ADR-0035
 * dec.5). Fluxo: `GET /api/me/shopping-lists` (o seletor) e UM `POST
 * /api/me/meal-plan/shopping-list?locale` com `{from, to, listId}` ou `{from, to, newListName}` — a
 * lista nova é criada pelo servidor no mesmo POST (nunca sobra lista órfã de um período vazio).
 * O período "De hoje até domingo" só existe com hoje DENTRO da semana e depois da segunda.
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
import { MealPlanShoppingListPanel } from '@/components/meal-plan/meal-plan-shopping-list-panel'

const M = ptBR.cardapio
const ML = ptBR.listaDeCompras
const WEEK_START = '2026-09-28'
const WEEK_END = '2026-10-04'

type FetchResult = { status: number; body: unknown }
type Call = { url: string; method: string; body: unknown }

function mockFetch(opts: {
  lists?: { id: string; name: string; itemCount?: number }[]
  generate?: FetchResult
}) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body != null ? JSON.parse(String(init.body)) : undefined })
    let r: FetchResult = { status: 404, body: {} }
    if (url === '/api/me/shopping-lists' && method === 'GET') r = { status: 200, body: { lists: opts.lists ?? [] } }
    else if (url.startsWith('/api/me/meal-plan/shopping-list') && method === 'POST')
      r = opts.generate ?? {
        status: 200,
        body: {
          ok: true,
          list: { id: 'nova', name: 'Compras da semana de 28/09/2026' },
          addedCount: 3,
          skippedCount: 0,
          semPorcoesCount: 0,
        },
      }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderPanel(today: string) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanShoppingListPanel weekStart={WEEK_START} weekEnd={WEEK_END} today={today} />
    </LocaleProvider>,
  )
}

const generateCall = (calls: Call[]) => calls.find((c) => c.url.startsWith('/api/me/meal-plan/shopping-list'))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MealPlanShoppingListPanel (ADR-0035 dec.5)', () => {
  it('lista NOVA (padrão): UM POST com {from, to, newListName}; nenhuma criação separada', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ lists: [] })
    renderPanel('2026-09-28') // hoje = segunda: sem escolha de período
    const nameInput = await screen.findByRole('textbox', { name: ML.nomeNovaLista })
    expect(nameInput).toHaveValue(M.nomeListaPadrao.replace('{data}', '28/09/2026'))

    await user.click(screen.getByRole('button', { name: M.gerarLista }))

    await waitFor(() => expect(generateCall(calls)).toBeDefined())
    expect(calls.some((c) => c.url === '/api/me/shopping-lists' && c.method === 'POST')).toBe(false)
    const gen = generateCall(calls)!
    expect(gen.url).toBe('/api/me/meal-plan/shopping-list?locale=pt-BR')
    expect(gen.body).toEqual({ from: WEEK_START, to: WEEK_END, newListName: 'Compras da semana de 28/09/2026' })
  })

  it('já existe a lista com o nome sugerido: ela vem PRÉ-ESCOLHIDA (gerar de novo soma nela)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      lists: [
        { id: 'l1', name: 'Mercado' },
        { id: 'l2', name: 'Compras da semana de 28/09/2026' },
      ],
    })
    renderPanel('2026-09-28')
    expect(await screen.findByRole('combobox', { name: M.listaDestino })).toHaveValue('l2')
    expect(screen.queryByRole('textbox', { name: ML.nomeNovaLista })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    await waitFor(() => expect(generateCall(calls)).toBeDefined())
    expect(generateCall(calls)!.body).toEqual({ from: WEEK_START, to: WEEK_END, listId: 'l2' })
  })

  it('lista EXISTENTE: não cria; gera direto na lista escolhida', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ lists: [{ id: 'l1', name: 'Mercado' }] })
    renderPanel('2026-09-28')
    const select = await screen.findByRole('combobox', { name: M.listaDestino })
    await user.selectOptions(select, 'l1')
    expect(screen.queryByRole('textbox', { name: ML.nomeNovaLista })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    await waitFor(() => expect(generateCall(calls)).toBeDefined())
    expect(calls.some((c) => c.url === '/api/me/shopping-lists' && c.method === 'POST')).toBe(false)
    expect(generateCall(calls)!.body).toEqual({ from: WEEK_START, to: WEEK_END, listId: 'l1' })
  })

  it('"De hoje até domingo" só aparece com hoje dentro da semana depois da segunda', async () => {
    mockFetch({ lists: [] })
    const r1 = renderPanel('2026-09-28') // segunda
    await screen.findByRole('combobox', { name: M.listaDestino })
    expect(screen.queryByRole('radio', { name: M.deHojeEmDiante })).not.toBeInTheDocument()
    r1.unmount()

    const r2 = renderPanel('2026-10-06') // semana seguinte (fora)
    await screen.findByRole('combobox', { name: M.listaDestino })
    expect(screen.queryByRole('radio', { name: M.deHojeEmDiante })).not.toBeInTheDocument()
    r2.unmount()

    renderPanel('2026-10-04') // domingo (dentro)
    expect(await screen.findByRole('radio', { name: M.deHojeEmDiante })).toBeChecked()
    expect(screen.getByRole('radio', { name: M.semanaInteira })).not.toBeChecked()
  })

  it('"De hoje até domingo" (padrão no meio da semana) muda o `from`; "Semana inteira" volta pra segunda', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ lists: [{ id: 'l1', name: 'Mercado' }] })
    renderPanel('2026-09-30')
    await user.selectOptions(await screen.findByRole('combobox', { name: M.listaDestino }), 'l1')
    expect(screen.getByRole('radio', { name: M.deHojeEmDiante })).toBeChecked()

    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    await waitFor(() => expect(generateCall(calls)).toBeDefined())
    expect(generateCall(calls)!.body).toEqual({ from: '2026-09-30', to: WEEK_END, listId: 'l1' })

    calls.length = 0
    await user.click(screen.getByRole('radio', { name: M.semanaInteira }))
    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    await waitFor(() => expect(generateCall(calls)).toBeDefined())
    expect(generateCall(calls)!.body).toEqual({ from: WEEK_START, to: WEEK_END, listId: 'l1' })
  })

  it('resultado: mensagem com link /me/shopping-lists/<id> + avisos de sem porções e indisponíveis', async () => {
    const user = userEvent.setup()
    mockFetch({
      lists: [],
      generate: {
        status: 200,
        body: { ok: true, list: { id: 'nova', name: 'Semana' }, addedCount: 5, skippedCount: 1, semPorcoesCount: 2 },
      },
    })
    renderPanel('2026-09-28')
    await screen.findByRole('textbox', { name: ML.nomeNovaLista })
    await user.click(screen.getByRole('button', { name: M.gerarLista }))

    expect(
      await screen.findByText(M.listaGerada.replace('{n}', '5').replace('{lista}', 'Semana'), { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: M.abrirLista })).toHaveAttribute('href', '/me/shopping-lists/nova')
    expect(screen.getByText(M.avisoSemPorcoes.replace('{n}', '2'))).toBeInTheDocument()
    expect(screen.getByText(M.algumasIndisponiveis)).toBeInTheDocument()
    // A lista nova vira a opção selecionada (gerar de novo não recria).
    expect(screen.getByRole('combobox', { name: M.listaDestino })).toHaveValue('nova')
  })

  it('resultado sem avisos: só a mensagem (singular) e o link', async () => {
    const user = userEvent.setup()
    mockFetch({
      lists: [{ id: 'l1', name: 'Mercado' }],
      generate: {
        status: 200,
        body: { ok: true, list: { id: 'l1', name: 'Mercado' }, addedCount: 1, skippedCount: 0, semPorcoesCount: 0 },
      },
    })
    renderPanel('2026-09-28')
    await user.selectOptions(await screen.findByRole('combobox', { name: M.listaDestino }), 'l1')
    await user.click(screen.getByRole('button', { name: M.gerarLista }))

    expect(
      await screen.findByText(M.listaGeradaSingular.replace('{lista}', 'Mercado'), { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: M.abrirLista })).toHaveAttribute('href', '/me/shopping-lists/l1')
    expect(screen.queryByText(M.algumasIndisponiveis)).not.toBeInTheDocument()
  })

  it('erro plano_vazio: mensagem localizada', async () => {
    const user = userEvent.setup()
    mockFetch({
      lists: [{ id: 'l1', name: 'Mercado' }],
      generate: { status: 422, body: { error: 'plano_vazio' } },
    })
    renderPanel('2026-09-28')
    await user.selectOptions(await screen.findByRole('combobox', { name: M.listaDestino }), 'l1')
    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    expect(await screen.findByText(M.erroPlanoVazio)).toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('link', { name: M.abrirLista })).not.toBeInTheDocument()
  })

  it('lista nova com nome já usado (nome_duplicado): mensagem da Lista de compras', async () => {
    const user = userEvent.setup()
    mockFetch({ lists: [], generate: { status: 409, body: { error: 'nome_duplicado' } } })
    renderPanel('2026-09-28')
    await screen.findByRole('textbox', { name: ML.nomeNovaLista })
    await user.click(screen.getByRole('button', { name: M.gerarLista }))
    expect(await screen.findByText(ML.erroNomeDuplicado)).toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('link', { name: M.abrirLista })).not.toBeInTheDocument()
  })

  it('nome da lista nova vazio: botão desabilitado', async () => {
    const user = userEvent.setup()
    mockFetch({ lists: [] })
    renderPanel('2026-09-28')
    await user.clear(await screen.findByRole('textbox', { name: ML.nomeNovaLista }))
    expect(screen.getByRole('button', { name: M.gerarLista })).toBeDisabled()
  })
})

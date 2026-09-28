import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do Cardápio da semana (`MealPlanWeekView`, ADR-0035). "Hoje" vem de `localTodayIso()`
 * (relógio do NAVEGADOR — dec.2): fixamos o relógio com `vi.setSystemTime` (sem fake timers, só o
 * `Date` é congelado — `setTimeout` do effect deferido e do userEvent seguem reais). Quarta
 * 2026-09-30 ⇒ semana 2026-09-28 (segunda) → 2026-10-04 (domingo).
 *
 * `fetch` roteado por URL/método no shape real das rotas: `GET /api/me/meal-plan?from&to&locale`,
 * `PATCH`/`DELETE /api/me/meal-plan/entries/[id]`. `next/navigation` mockado com `router.replace`
 * espião e `useSearchParams` controlável (a semana visível mora em `?semana=`).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const nav = vi.hoisted(() => ({
  search: '' as string,
  replace: null as unknown as (...args: unknown[]) => void,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/me/meal-plan',
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

function setSession(state: 'logged-in' | 'anon' | 'pending') {
  authMock.session =
    state === 'logged-in'
      ? { data: { user: { id: 'u1' } }, isPending: false, error: null }
      : state === 'anon'
        ? { data: null, isPending: false, error: null }
        : { data: null, isPending: true, error: null }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { MealPlanWeekView, type MealPlanEntry } from '@/components/meal-plan/meal-plan-week-view'

const M = ptBR.cardapio
const TODAY = '2026-09-30'
const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']

function entry(over: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e1',
    day: TODAY,
    slot: 'jantar',
    porcoes: null,
    createdAt: '2026-09-27T10:00:00.000Z',
    note: null,
    recipe: { id: 'r1', name: 'Feijoada', slug: 'feijoada', porcoes: 4 },
    ...over,
  }
}

type FetchResult = { status: number; body: unknown }
type Call = { url: URL; method: string; body: unknown }

function mockFetch(opts: {
  entries?: MealPlanEntry[] | (() => MealPlanEntry[])
  patch?: FetchResult
  /** Segura cada PATCH até a promessa resolver (pra observar requisições em voo). */
  patchGate?: () => Promise<void>
  del?: FetchResult
  copy?: FetchResult
}) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body != null ? JSON.parse(String(init.body)) : undefined })
    let r: FetchResult = { status: 404, body: {} }
    if (url.pathname === '/api/me/meal-plan' && method === 'GET') {
      const entries = typeof opts.entries === 'function' ? opts.entries() : (opts.entries ?? [])
      r = { status: 200, body: { entries } }
    } else if (url.pathname.startsWith('/api/me/meal-plan/entries/') && method === 'PATCH') {
      if (opts.patchGate) await opts.patchGate()
      r = opts.patch ?? { status: 200, body: { ok: true } }
    } else if (url.pathname.startsWith('/api/me/meal-plan/entries/') && method === 'DELETE') {
      r = opts.del ?? { status: 200, body: { ok: true } }
    } else if (url.pathname === '/api/me/meal-plan/copy-previous-week' && method === 'POST') {
      r = opts.copy ?? { status: 200, body: { ok: true, addedCount: 0, skippedCount: 0 } }
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderView() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanWeekView />
    </LocaleProvider>,
  )
}

/** O cartão (`<li>`) de um dia, pelo id do cabeçalho `cardapio-dia-<dia>`. */
function dayCard(day: string): HTMLElement {
  const heading = document.getElementById(`cardapio-dia-${day}`)
  if (heading == null) throw new Error(`sem cartão para ${day}`)
  return heading.closest('li') as HTMLElement
}

/** Espera a semana carregar (o resumo só aparece com status idle). */
async function waitLoaded(n: number) {
  const text = n === 1 ? M.resumoSemanaSingular : M.resumoSemana.replace('{n}', String(n))
  await screen.findByText(text)
}

beforeEach(() => {
  vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0)) // quarta 30/09/2026, meio-dia LOCAL
  setSession('logged-in')
  nav.search = ''
  nav.replace = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MealPlanWeekView (ADR-0035)', () => {
  it('Visitante: convite pra entrar (link /sign-in com returnTo), sem fetch', () => {
    setSession('anon')
    const { impl } = mockFetch({})
    renderView()
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fpt-BR%2Fme%2Fmeal-plan',
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('logado: 7 dias segunda → domingo da semana de hoje, hoje marcado; pede from/to/locale certos', async () => {
    const { calls } = mockFetch({ entries: [] })
    renderView()
    await screen.findByText(M.vazioSemana)

    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings).toHaveLength(7)
    expect(headings.map((h) => h.id)).toEqual(WEEK.map((d) => `cardapio-dia-${d}`))
    // Primeira letra maiúscula, resto intacto (capitalizeFirst — não o `capitalize` do CSS).
    expect(headings[0]).toHaveTextContent(/^Segunda-feira/)
    expect(headings[6]).toHaveTextContent(/^Domingo/)

    // "Hoje" só no cartão de quarta.
    expect(screen.getAllByText(M.hoje)).toHaveLength(1)
    expect(within(dayCard(TODAY)).getByText(M.hoje)).toBeInTheDocument()
    // Semana atual: sem botão "Esta semana".
    expect(screen.queryByRole('button', { name: M.estaSemana })).not.toBeInTheDocument()

    const get = calls.find((c) => c.url.pathname === '/api/me/meal-plan')
    expect(get?.url.searchParams.get('from')).toBe('2026-09-28')
    expect(get?.url.searchParams.get('to')).toBe('2026-10-04')
    expect(get?.url.searchParams.get('locale')).toBe('pt-BR')
  })

  it('?semana= na URL: mostra aquela semana e pede o intervalo dela', async () => {
    nav.search = 'semana=2026-10-07' // quarta → normaliza pra segunda 05/10
    const { calls } = mockFetch({ entries: [] })
    renderView()
    await screen.findByText(M.vazioSemana)
    const get = calls.find((c) => c.url.pathname === '/api/me/meal-plan')
    expect(get?.url.searchParams.get('from')).toBe('2026-10-05')
    expect(get?.url.searchParams.get('to')).toBe('2026-10-11')
    // Fora da semana atual: sem marca de hoje, com o atalho "Esta semana".
    expect(screen.queryByText(M.hoje)).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: M.estaSemana }))
    expect(nav.replace).toHaveBeenCalledWith('/pt-BR/me/meal-plan', { scroll: false })
  })

  it('agrupa as Refeições planejadas do dia por refeição, na ordem café → almoço → lanche → jantar', async () => {
    mockFetch({
      entries: [
        entry({ id: 'e1', slot: 'jantar', recipe: { id: 'r1', name: 'Feijoada', porcoes: 4 } }),
        entry({ id: 'e2', slot: 'almoco', recipe: { id: 'r2', name: 'Salada', porcoes: 2 } }),
        entry({ id: 'e3', slot: 'jantar', recipe: { id: 'r3', name: 'Arroz', porcoes: 4 } }),
        entry({ id: 'e4', day: '2026-10-02', slot: 'cafe_da_manha', recipe: { id: 'r4', name: 'Tapioca', porcoes: 1 } }),
      ],
    })
    renderView()
    await waitLoaded(4)

    const quarta = within(dayCard(TODAY))
    const slots = quarta.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(slots).toEqual([M.slotAlmoco, M.slotJantar])
    const jantarSection = quarta.getByRole('heading', { level: 4, name: M.slotJantar }).closest('section')!
    expect(within(jantarSection).getByText('Feijoada')).toBeInTheDocument()
    expect(within(jantarSection).getByText('Arroz')).toBeInTheDocument()
    expect(within(jantarSection).queryByText('Salada')).not.toBeInTheDocument()

    const sexta = within(dayCard('2026-10-02'))
    expect(sexta.getByRole('heading', { level: 4 })).toHaveTextContent(M.slotCafeDaManha)
    expect(sexta.getByText('Tapioca')).toBeInTheDocument()
    // Dia sem nada: "Nada planejado".
    expect(within(dayCard('2026-09-28')).getByText(M.vazioDia)).toBeInTheDocument()
    // Porção singular.
    expect(sexta.getByText(M.porcaoValor)).toBeInTheDocument()
  })

  it('Receita indisponível (recipe: null): mostra o rótulo, sem link e sem seletor de porções', async () => {
    mockFetch({ entries: [entry({ id: 'e9', recipe: null, porcoes: 3 })] })
    renderView()
    await waitLoaded(1)
    const card = within(dayCard(TODAY))
    expect(card.getByText(M.receitaIndisponivel)).toBeInTheDocument()
    // A dica fica VISÍVEL (title não funciona no toque).
    expect(card.getByText(M.receitaIndisponivelDica)).toBeInTheDocument()
    expect(card.queryByRole('link')).not.toBeInTheDocument()
    expect(
      card.queryByRole('button', { name: M.porcoesAumentar.replace('{nome}', M.receitaIndisponivel) }),
    ).not.toBeInTheDocument()
    // Ainda dá pra tirar do cardápio.
    expect(
      card.getByRole('button', { name: M.remover.replace('{nome}', M.receitaIndisponivel) }),
    ).toBeInTheDocument()
  })

  it('+ / − porções: PATCH {porcoes} com o valor novo (otimista na tela)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ entries: [entry({ porcoes: null })] })
    renderView()
    await waitLoaded(1)
    expect(screen.getByText(M.porcoesValor.replace('{n}', '4'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: M.porcoesAumentar.replace('{nome}', 'Feijoada') }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url.pathname).toBe('/api/me/meal-plan/entries/e1')
    expect(patch.body).toEqual({ porcoes: 5 })
    expect(screen.getByText(M.porcoesValor.replace('{n}', '5'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: M.porcoesDiminuir.replace('{nome}', 'Feijoada') }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'PATCH')[1].body).toEqual({ porcoes: 4 })
  })

  it('cliques rápidos em +: um PATCH por vez; o último leva o valor final (intermediários coalescidos)', async () => {
    const user = userEvent.setup()
    let inFlight = 0
    let maxInFlight = 0
    const gates: (() => void)[] = []
    const { calls } = mockFetch({
      entries: [entry({ porcoes: 4 })],
      patchGate: () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        return new Promise<void>((resolve) =>
          gates.push(() => {
            inFlight -= 1
            resolve()
          }),
        )
      },
    })
    renderView()
    await waitLoaded(1)
    const mais = screen.getByRole('button', { name: M.porcoesAumentar.replace('{nome}', 'Feijoada') })
    const patches = () => calls.filter((c) => c.method === 'PATCH')

    // 3 cliques com o 1º PATCH ainda em voo: a tela anda 4 → 7, mas só UM PATCH saiu (5).
    await user.click(mais)
    await user.click(mais)
    await user.click(mais)
    expect(screen.getByText(M.porcoesValor.replace('{n}', '7'))).toBeInTheDocument()
    expect(patches().map((c) => c.body)).toEqual([{ porcoes: 5 }])

    // O 1º volta → sai UM PATCH com o valor mais recente (7); o 6 intermediário nunca é enviado.
    gates.shift()!()
    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1].body).toEqual({ porcoes: 7 })
    gates.shift()!()
    // Nada mais pendente: nenhum PATCH extra depois do último.
    await new Promise((r) => setTimeout(r, 20))
    expect(patches()).toHaveLength(2)
    expect(maxInFlight).toBe(1)
    expect(screen.getByText(M.porcoesValor.replace('{n}', '7'))).toBeInTheDocument()
  })

  it('− fica desabilitado em 1 porção', async () => {
    mockFetch({ entries: [entry({ porcoes: 1 })] })
    renderView()
    await waitLoaded(1)
    expect(screen.getByRole('button', { name: M.porcoesDiminuir.replace('{nome}', 'Feijoada') })).toBeDisabled()
  })

  it('mover: PATCH {day, slot} e recarrega a semana', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ entries: [entry()] })
    renderView()
    await waitLoaded(1)
    const gets = () => calls.filter((c) => c.method === 'GET').length
    const before = gets()

    const select = screen.getByRole('combobox', { name: M.moverPara.replace('{nome}', 'Feijoada') })
    expect(select).toHaveValue(`${TODAY}|jantar`)
    // Rótulo da opção: dia curto capitalizado · refeição; o grupo é o dia por extenso + data.
    const sexAlmoco = within(select).getByRole('option', { name: 'Sex. · Almoço' })
    expect(sexAlmoco).toHaveValue('2026-10-02|almoco')
    expect(sexAlmoco.closest('optgroup')).toHaveAttribute('label', 'Sexta-feira 2 de out.')
    await user.selectOptions(select, '2026-10-02|almoco')

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url.pathname).toBe('/api/me/meal-plan/entries/e1')
    expect(patch.body).toEqual({ day: '2026-10-02', slot: 'almoco' })
    await waitFor(() => expect(gets()).toBeGreaterThan(before))
  })

  it('tirar: DELETE na entrada e ela some da tela', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ entries: [entry()] })
    renderView()
    await waitLoaded(1)

    await user.click(screen.getByRole('button', { name: M.remover.replace('{nome}', 'Feijoada') }))
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url.pathname).toBe('/api/me/meal-plan/entries/e1')
    expect(screen.queryByText('Feijoada')).not.toBeInTheDocument()
  })

  it('próxima/anterior semana: router.replace com ?semana=<segunda>', async () => {
    const user = userEvent.setup()
    mockFetch({ entries: [] })
    renderView()
    await screen.findByText(M.vazioSemana)

    await user.click(screen.getByRole('button', { name: M.proximaSemana }))
    expect(nav.replace).toHaveBeenLastCalledWith('/pt-BR/me/meal-plan?semana=2026-10-05', { scroll: false })
    await user.click(screen.getByRole('button', { name: M.semanaAnterior }))
    expect(nav.replace).toHaveBeenLastCalledWith('/pt-BR/me/meal-plan?semana=2026-09-21', { scroll: false })
  })

  it('"Gerar lista de compras" desabilitado sem Refeições; habilitado e abre o painel com Refeições', async () => {
    const user = userEvent.setup()
    mockFetch({ entries: [] })
    const { unmount } = renderView()
    await screen.findByText(M.vazioSemana)
    expect(screen.getByRole('button', { name: M.gerarLista })).toBeDisabled()
    unmount()

    vi.unstubAllGlobals()
    mockFetch({ entries: [entry()] })
    renderView()
    await waitLoaded(1)
    const btn = screen.getByRole('button', { name: M.gerarLista })
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(M.gerarListaDescricao)).toBeInTheDocument()
  })

  it('erro dia_cheio no PATCH: mostra a mensagem localizada', async () => {
    const user = userEvent.setup()
    mockFetch({ entries: [entry()], patch: { status: 409, body: { error: 'dia_cheio' } } })
    renderView()
    await waitLoaded(1)

    await user.selectOptions(
      screen.getByRole('combobox', { name: M.moverPara.replace('{nome}', 'Feijoada') }),
      '2026-10-01|jantar',
    )
    expect(await screen.findByText(M.erroDiaCheio)).toBeInTheDocument()
    expect(screen.getByText(M.erroDiaCheio)).toHaveAttribute('role', 'alert')
  })

  it('falha ao carregar a semana: alerta com "tentar de novo"', async () => {
    const impl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)
    vi.stubGlobal('fetch', impl)
    renderView()
    expect(await screen.findByText(M.erroCarregar)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptBR.system.retry })).toBeInTheDocument()
  })

  it('"Adicionar" num dia abre o seletor de Receita', async () => {
    const user = userEvent.setup()
    const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input), 'http://localhost')
      const body =
        url.pathname === '/api/me/meal-plan' ? { entries: [] } : { recipes: [] }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', impl)
    renderView()
    await screen.findByText(M.vazioSemana)

    await user.click(within(dayCard('2026-10-01')).getByRole('button', { name: /^Adicionar receita em/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.escolherReceita)).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: M.dia })).toHaveValue('2026-10-01')
  })
})

describe('MealPlanWeekView — Anotação e copiar semana (ADR-0037)', () => {
  it('Anotação: mostra o texto, sem seletor de porções; tirar e mover usam o texto como nome', async () => {
    mockFetch({ entries: [entry({ id: 'n1', note: 'Jantar fora', recipe: null })] })
    renderView()
    await waitLoaded(1)

    const card = dayCard(TODAY)
    expect(within(card).getByText('Jantar fora')).toBeInTheDocument()
    expect(within(card).queryByText(M.receitaIndisponivel)).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Menos porções/ })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: M.remover.replace('{nome}', 'Jantar fora') })).toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: M.moverPara.replace('{nome}', 'Jantar fora') })).toBeInTheDocument()
  })

  it('semana só com Anotações: "Gerar lista de compras" fica desabilitado (não há ingredientes)', async () => {
    mockFetch({ entries: [entry({ id: 'n1', note: 'Sobras', recipe: null })] })
    renderView()
    await waitLoaded(1)
    expect(screen.getByRole('button', { name: M.gerarLista })).toBeDisabled()
  })

  it('"Copiar semana anterior" na semana corrente: manda a semana e hoje, mostra o resultado e recarrega', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      entries: [],
      copy: { status: 200, body: { ok: true, addedCount: 3, skippedCount: 1 } },
    })
    renderView()
    await screen.findByText(M.vazioSemana)
    const getsBefore = calls.filter((c) => c.url.pathname === '/api/me/meal-plan').length

    await user.click(screen.getByRole('button', { name: M.copiarSemana }))
    expect(
      await screen.findByText(`${M.copiadas.replace('{n}', '3')} ${M.copiaPuladasSingular}`),
    ).toBeInTheDocument()

    const post = calls.find((c) => c.url.pathname === '/api/me/meal-plan/copy-previous-week')
    expect(post?.body).toEqual({ week: '2026-09-28', fromDay: TODAY })
    await waitFor(() =>
      expect(calls.filter((c) => c.url.pathname === '/api/me/meal-plan').length).toBeGreaterThan(getsBefore),
    )
  })

  it('"Copiar semana anterior" noutra semana: copia a semana inteira (sem fromDay)', async () => {
    nav.search = 'semana=2026-10-05'
    const user = userEvent.setup()
    const { calls } = mockFetch({ entries: [], copy: { status: 200, body: { ok: true, addedCount: 0, skippedCount: 2 } } })
    renderView()
    await screen.findByText(M.vazioSemana)
    await user.click(screen.getByRole('button', { name: M.copiarSemana }))
    expect(await screen.findByText(M.copiaNada)).toBeInTheDocument()
    const post = calls.find((c) => c.url.pathname === '/api/me/meal-plan/copy-previous-week')
    expect(post?.body).toEqual({ week: '2026-10-05' })
  })

  it('semana anterior vazia (422): alerta localizado', async () => {
    const user = userEvent.setup()
    mockFetch({ entries: [], copy: { status: 422, body: { error: 'semana_anterior_vazia' } } })
    renderView()
    await screen.findByText(M.vazioSemana)
    await user.click(screen.getByRole('button', { name: M.copiarSemana }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroCopiaVazia)
  })
})

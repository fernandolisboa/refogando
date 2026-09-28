import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeListItem } from '@/domain/recipe-list-read'

/**
 * Teste jsdom do seletor de Receita do Cardápio (`MealPlanRecipePicker`, ADR-0035 dec.4): junta
 * Salvos (`/api/me/saved`) + Minhas criações (`/api/me/recipes`) sem repetir, esconde o que não é
 * planejável (brincadeira, removida por moderação, importada da web), busca sem acento e planeja
 * com um toque (`POST /api/me/meal-plan/entries`). Relógio fixado ao meio-dia (a refeição sugerida
 * depende da hora) — mesmo assim os testes escolhem a refeição explicitamente.
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
import { MealPlanRecipePicker } from '@/components/meal-plan/meal-plan-recipe-picker'

const M = ptBR.cardapio
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']

function item(over: Partial<RecipeListItem> = {}): RecipeListItem {
  return {
    id: 'r-1',
    name: 'Bolo de fubá',
    origin: 'ai_structured',
    visibility: 'private',
    resultKind: 'success',
    lineageKind: null,
    updatedAt: '2026-06-18T00:00:00.000Z',
    moderationRemovida: false,
    ...over,
  }
}

type FetchResult = { status: number; body: unknown }
type Call = { url: string; method: string; body: unknown }

function mockFetch(opts: { saved: RecipeListItem[]; mine: RecipeListItem[]; post?: FetchResult }) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body != null ? JSON.parse(String(init.body)) : undefined })
    let r: FetchResult = { status: 404, body: {} }
    if (url.startsWith('/api/me/saved')) r = { status: 200, body: { recipes: opts.saved } }
    else if (url.startsWith('/api/me/recipes')) r = { status: 200, body: { recipes: opts.mine } }
    else if (url === '/api/me/meal-plan/entries' && method === 'POST') r = opts.post ?? { status: 201, body: {} }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderPicker(onPlanned = vi.fn()) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanRecipePicker open onOpenChange={() => {}} initialDay="2026-09-30" days={DAYS} onPlanned={onPlanned} />
    </LocaleProvider>,
  )
  return onPlanned
}

/** Nomes das Receitas oferecidas (o texto do botão de cada linha, sem o "Adicionar"). */
function offeredNames(): string[] {
  const dialog = screen.getByRole('dialog')
  return within(dialog)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('span.flex-1')?.textContent ?? '')
}

beforeEach(() => {
  vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MealPlanRecipePicker (ADR-0035 dec.4)', () => {
  it('junta Salvos + Minhas criações sem repetir e esconde brincadeira/removida/importada da web', async () => {
    const { calls } = mockFetch({
      saved: [item({ id: 'a', name: 'Feijão tropeiro' }), item({ id: 'b', name: 'Moqueca' })],
      mine: [
        item({ id: 'b', name: 'Moqueca' }),
        item({ id: 'c', name: 'Pizza de pedra', resultKind: 'playful' }),
        item({ id: 'd', name: 'Removida', moderationRemovida: true }),
        item({ id: 'e', name: 'Importada', origin: 'web_imported' }),
        item({ id: 'f', name: 'Pão de queijo' }),
      ],
    })
    renderPicker()
    await screen.findByText('Pão de queijo')

    expect(offeredNames()).toEqual(['Feijão tropeiro', 'Moqueca', 'Pão de queijo'])
    expect(screen.queryByText('Pizza de pedra')).not.toBeInTheDocument()
    expect(screen.queryByText('Removida')).not.toBeInTheDocument()
    expect(screen.queryByText('Importada')).not.toBeInTheDocument()
    // Pede os dois acervos no locale corrente.
    expect(calls.map((c) => c.url)).toEqual(
      expect.arrayContaining(['/api/me/saved?locale=pt-BR', '/api/me/recipes?locale=pt-BR']),
    )
  })

  it('fechar ENQUANTO carrega não trava: a carga em voo termina e a reabertura mostra o acervo sem refazer a busca', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      await gate
      const url = String(input)
      const recipes = url.startsWith('/api/me/saved') ? [item({ id: 'a', name: 'Feijão tropeiro' })] : []
      return { ok: true, status: 200, json: async () => ({ recipes }) } as Response
    })
    vi.stubGlobal('fetch', impl)
    const props = { onOpenChange: () => {}, initialDay: '2026-09-30', days: DAYS, onPlanned: vi.fn() }
    const view = render(
      <LocaleProvider initialLocale="pt-BR">
        <MealPlanRecipePicker open {...props} />
      </LocaleProvider>,
    )
    await waitFor(() => expect(impl).toHaveBeenCalled())
    view.rerender(
      <LocaleProvider initialLocale="pt-BR">
        <MealPlanRecipePicker open={false} {...props} />
      </LocaleProvider>,
    )
    release()
    view.rerender(
      <LocaleProvider initialLocale="pt-BR">
        <MealPlanRecipePicker open {...props} />
      </LocaleProvider>,
    )
    expect(await screen.findByText('Feijão tropeiro')).toBeInTheDocument()
    expect(impl).toHaveBeenCalledTimes(2) // Salvos + Minhas criações, uma vez só
  })

  it('busca ignora acento e caixa', async () => {
    const user = userEvent.setup()
    mockFetch({
      saved: [item({ id: 'a', name: 'Feijão tropeiro' }), item({ id: 'b', name: 'Moqueca' })],
      mine: [],
    })
    renderPicker()
    await screen.findByText('Moqueca')

    const search = screen.getByRole('searchbox', { name: M.buscarReceita })
    await user.type(search, 'FEIJAO')
    expect(offeredNames()).toEqual(['Feijão tropeiro'])

    await user.clear(search)
    await user.type(search, 'xyz')
    expect(offeredNames()).toEqual([])
    expect(screen.getByText(M.semResultados)).toBeInTheDocument()
  })

  it('tocar numa Receita: POST {recipeId, day, slot} com o dia/refeição escolhidos e chama onPlanned', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ saved: [item({ id: 'a', name: 'Moqueca' })], mine: [] })
    const onPlanned = renderPicker()
    await screen.findByText('Moqueca')

    const daySelect = screen.getByRole('combobox', { name: M.dia })
    expect(daySelect).toHaveValue('2026-09-30') // começa no dia clicado
    await user.selectOptions(daySelect, '2026-10-02')
    await user.selectOptions(screen.getByRole('combobox', { name: M.refeicao }), 'jantar')
    await user.click(screen.getByRole('button', { name: /Moqueca/ }))

    await waitFor(() => expect(onPlanned).toHaveBeenCalledTimes(1))
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.url).toBe('/api/me/meal-plan/entries')
    expect(post?.body).toEqual({ recipeId: 'a', day: '2026-10-02', slot: 'jantar' })
  })

  it('erro dia_cheio: mensagem localizada e NÃO chama onPlanned', async () => {
    const user = userEvent.setup()
    mockFetch({
      saved: [item({ id: 'a', name: 'Moqueca' })],
      mine: [],
      post: { status: 409, body: { error: 'dia_cheio' } },
    })
    const onPlanned = renderPicker()
    await screen.findByText('Moqueca')

    await user.click(screen.getByRole('button', { name: /Moqueca/ }))
    expect(await screen.findByText(M.erroDiaCheio)).toHaveAttribute('role', 'alert')
    expect(onPlanned).not.toHaveBeenCalled()
  })

  it('acervo vazio: convite a explorar', async () => {
    mockFetch({ saved: [], mine: [item({ id: 'c', name: 'Brincadeira', resultKind: 'playful' })] })
    renderPicker()
    expect(await screen.findByText(M.semReceitas, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: M.explorar })).toHaveAttribute('href', '/')
  })

  it('falha ao carregar o acervo: alerta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response),
    )
    renderPicker()
    expect(await screen.findByText(M.erroCarregarReceitas)).toHaveAttribute('role', 'alert')
  })
})

describe('MealPlanRecipePicker — Anotação (ADR-0037)', () => {
  it('anota um texto livre no dia/refeição escolhidos (normalizado) e fecha', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ saved: [], mine: [], post: { status: 200, body: { ok: true, entryId: 'n1' } } })
    const onPlanned = renderPicker()
    await screen.findByText(M.semReceitas)

    await user.selectOptions(screen.getByRole('combobox', { name: M.refeicao }), 'jantar')
    await user.type(screen.getByRole('textbox', { name: M.anotacaoTitulo }), '  Jantar   fora ')
    await user.click(screen.getByRole('button', { name: M.anotar }))

    await waitFor(() => expect(onPlanned).toHaveBeenCalled())
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ note: 'Jantar fora', day: '2026-09-30', slot: 'jantar' })
  })

  it('atalho ("Sobras") anota com um toque; 400 do servidor vira a mensagem de anotação', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ saved: [], mine: [], post: { status: 400, body: { error: 'dados_invalidos' } } })
    const onPlanned = renderPicker()
    await screen.findByText(M.semReceitas)

    await user.click(screen.getByRole('button', { name: M.anotarRapido.replace('{texto}', 'Sobras') }))
    expect(await screen.findByText(M.erroAnotacao)).toBeInTheDocument()
    expect(onPlanned).not.toHaveBeenCalled()
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ note: 'Sobras' })
  })

  it('"Anotar" fica desabilitado com o campo vazio', async () => {
    mockFetch({ saved: [], mine: [] })
    renderPicker()
    await screen.findByText(M.semReceitas)
    expect(screen.getByRole('button', { name: M.anotar })).toBeDisabled()
  })
})


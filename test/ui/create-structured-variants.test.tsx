import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * "Gerar 2, o usuário escolhe" (#423) pela tela CRIAR estruturada — seam de frontend. Exercita o motor
 * `useRecipeGeneration` convergindo para o estado 'choice' e depois para 'result' ao escolher. `fetch`
 * mockado no shape REAL: POST /api/generations → `{outcome:'variants', variants:[…×2]}`; GET
 * /api/recipes/{id} → RecipeView por id; POST /api/generations/choice → `{ok:true}`.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

let sessionState: {
  data: unknown
  error: unknown
  isPending: boolean
  isRefetching: boolean
  refetch: () => void
}
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { LocaleProvider } from '@/i18n/provider'
import { WithCozinhaVocab } from '../helpers/cozinha-vocab'
import { RecipeVariantProvider } from '@/components/recipe/recipe-variant-provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CreateStructuredExperience } from '@/components/recipe/create-structured-experience'

const M = ptBR.criar

function authed() {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Feijão tropeiro',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Um prato mineiro.', passos: ['Refogue', 'Misture'], notas: null },
    facets: { cozinha: 'mineira', categoria: 'prato_principal', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 1, quantidade: '2.000', unidade: 'xicara', rawText: 'feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

function makeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** Mocka fetch: /api/generations (POST), /api/recipes/<id> (GET, view por id), /api/generations/choice. */
function mockFetch(opts: {
  generations: unknown
  views: Record<string, RecipeView>
  choice?: unknown
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.includes('/api/generations/choice')) return makeResponse(200, opts.choice ?? { ok: true })
    if (url.includes('/api/generations')) return makeResponse(201, opts.generations)
    if (url.includes('/api/recipes/')) {
      const id = url.split('/api/recipes/')[1].split('?')[0]
      const v = opts.views[id]
      return v ? makeResponse(200, v) : makeResponse(404, { error: 'not_found' })
    }
    throw new Error(`fetch não mockado: ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderCreate(variantEnabled: boolean) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <WithCozinhaVocab>
        <RecipeVariantProvider enabled={variantEnabled}>
          <CreateStructuredExperience />
        </RecipeVariantProvider>
      </WithCozinhaVocab>
    </LocaleProvider>,
  )
}

function ingredientTextboxes(): HTMLElement[] {
  return screen.getAllByRole('textbox').filter((el) => el.getAttribute('id') !== 'entrada-inteligente')
}

beforeEach(() => {
  sessionState = authed()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const VARIANTS_BODY = {
  outcome: 'variants',
  variants: [
    { recipeId: 'r-1', slug: 's-1', locale: 'pt-BR', label: 'tradicional', generationId: 'g-1', outcome: 'success', advisory: null },
    { recipeId: 'r-2', slug: 's-2', locale: 'pt-BR', label: 'criativa', generationId: 'g-2', outcome: 'degraded', advisory: 'Troquei X.' },
  ],
}

describe('CreateStructuredExperience — variação de geração (#423)', () => {
  it('feature DESLIGADA (default): o opt-in "Gerar 2 versões" NÃO aparece', () => {
    mockFetch({ generations: {}, views: {} })
    renderCreate(false)
    expect(screen.queryByText(M.variar2Label)).toBeNull()
  })

  it('feature ligada: opt-in aparece; marcar + gerar → POST com variar2 → estado de ESCOLHA (2 receitas)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: VARIANTS_BODY,
      views: {
        'r-1': baseView({ id: 'r-1', name: 'Feijão à moda antiga' }),
        'r-2': baseView({ id: 'r-2', name: 'Feijão desconstruído' }),
      },
    })
    renderCreate(true)

    // O opt-in aparece.
    const checkbox = screen.getByRole('checkbox', { name: new RegExp(M.variar2Label) })
    expect(checkbox).toBeInTheDocument()

    await user.type(ingredientTextboxes()[0], 'feijão')
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // Estado de ESCOLHA: título + as 2 receitas + 2 CTAs.
    expect(await screen.findByText(M.variacaoTitulo)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Feijão à moda antiga' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Feijão desconstruído' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: M.variacaoEscolher })).toHaveLength(2)

    // O POST subiu variar2: true.
    const postCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/generations'))!
    const sent = JSON.parse((postCall[1] as RequestInit).body as string)
    expect(sent.mode).toBe('structured')
    expect(sent.variar2).toBe(true)

    // Buscou o corpo das 2 receitas.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/r-1'))).toBe(true)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/r-2'))).toBe(true)
  })

  it('escolher uma variação → POST /choice com o generationId → converge para o RESULTADO da escolhida', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: VARIANTS_BODY,
      views: {
        'r-1': baseView({ id: 'r-1', name: 'Feijão à moda antiga' }),
        'r-2': baseView({ id: 'r-2', name: 'Feijão desconstruído' }),
      },
    })
    renderCreate(true)

    await user.type(ingredientTextboxes()[0], 'feijão')
    await user.click(screen.getByRole('checkbox', { name: new RegExp(M.variar2Label) }))
    await user.click(screen.getByRole('button', { name: M.gerar }))
    await screen.findByText(M.variacaoTitulo)

    // Escolhe a 2ª coluna (a 'degraded').
    const col2 = screen.getByRole('region', { name: M.variacaoColuna.replace('{n}', '2') })
    await user.click(within(col2).getByRole('button', { name: M.variacaoEscolher }))

    // Converge para o resultado da ESCOLHIDA (degraded → mensagem de limitação + a receita).
    expect(await screen.findByText(M.resultadoDegradado)).toBeInTheDocument()
    expect(screen.getByText(/Troquei X\./)).toBeInTheDocument()
    // A tela de escolha sumiu.
    expect(screen.queryByText(M.variacaoTitulo)).toBeNull()

    // POST /choice com o generationId da 2ª variação (server-authoritative).
    const choiceCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations/choice'))!
    expect(choiceCall).toBeTruthy()
    expect(JSON.parse((choiceCall[1] as RequestInit).body as string)).toEqual({ generationId: 'g-2' })
  })
})

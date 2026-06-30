import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom do `RecipeManagementArea` (#bug "dono não gerencia a própria receita pública"). Prova
 * QUAL view a área usa e o que renderiza em cada caminho:
 *  - PATH 2 (`view.canManage`): gestão DIRETO, SEM fetch.
 *  - PATH 1 + logado + dono (fetch devolve view com canManage): gestão a partir da view buscada.
 *  - PATH 1 + logado + não-dono (fetch 404): "Criar minha versão".
 *  - PATH 1 + anônimo: convite, SEM fetch.
 *  - PATH 1 + sessão pendente / fetch em voo: NADA (sem flash).
 *  - PATH 1 + fetch falha: degrada pra "Criar minha versão".
 * `useSession`/`next/navigation`/`next/link` mockados (espelha recipe-detail-actions.test).
 */

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

function setSession(kind: 'logged-in' | 'anon' | 'pending') {
  sessionState = {
    data: kind === 'logged-in' ? { user: { id: 'u-1' } } : null,
    error: null,
    isPending: kind === 'pending',
    isRefetching: false,
    refetch: vi.fn(),
  }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeManagementArea } from '@/components/recipe/recipe-management-area'

const M = ptBR

function ownerView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Bolo simples',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Doce caseiro', passos: ['Misture', 'Asse'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'sobremesa', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 0, quantidade: '2.000', unidade: 'xicara', rawText: '2 xícaras de farinha' }],
    translations: [],
    autoTranslationSignal: false,
    canManage: true,
    visibility: 'private',
    resultKind: 'success',
    gallery: [],
    imageGenEnabled: true,
    imageGenBlocked: false,
    ...over,
  } as RecipeView
}
/** View do caminho PÚBLICO: sem os campos owner-gated (canManage/visibility ausentes). */
function publicView(over: Partial<RecipeView> = {}): RecipeView {
  const v = ownerView(over)
  delete (v as Partial<RecipeView>).canManage
  delete (v as Partial<RecipeView>).visibility
  delete (v as Partial<RecipeView>).gallery
  return v
}

type FetchResult = { status: number; body: unknown } | { reject: true }
function mockFetch(result: FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (!url.includes('/api/recipes/')) throw new Error(`fetch não mockado: ${url}`)
    if ('reject' in result) throw new TypeError('network down')
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderArea(view: RecipeView) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeManagementArea view={view} locale="pt-BR" reviewImage={false} />
    </LocaleProvider>,
  )
}

beforeEach(() => setSession('logged-in'))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeManagementArea', () => {
  it('PATH 2 (server canManage): gestão DIRETO ("Editar"), sem "Criar minha versão", SEM fetch', () => {
    const fetchMock = mockFetch({ status: 200, body: {} })
    renderArea(ownerView())

    expect(screen.getByRole('button', { name: M.minhasCriacoes.editar })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATH 1 + DONO: busca a view do dono e mostra gestão ("Editar"), NÃO "Criar minha versão"', async () => {
    const fetchMock = mockFetch({ status: 200, body: ownerView() })
    renderArea(publicView())

    expect(await screen.findByRole('button', { name: M.minhasCriacoes.editar })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeNull()
    // Bateu na rota do dono com o locale.
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1?locale=pt-BR')
  })

  it('PATH 1 + NÃO-dono (404 privada-de-outro): "Criar minha versão", nunca "Editar"', async () => {
    mockFetch({ status: 404, body: { error: 'not_found' } })
    renderArea(publicView({ origin: 'catalog' }))

    expect(await screen.findByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.editar })).toBeNull()
  })

  it('PATH 1 + NÃO-dono (200 SEM canManage — pública de outro): "Criar minha versão", nunca "Editar"', async () => {
    // Receita pública de OUTRO: a rota do dono devolve 200 mas sem canManage. NÃO vira gestão.
    mockFetch({ status: 200, body: publicView({ origin: 'catalog' }) })
    renderArea(publicView({ origin: 'catalog' }))

    expect(await screen.findByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.editar })).toBeNull()
  })

  it('PATH 1 + ANÔNIMO: convite a entrar, SEM fetch, sem "Criar minha versão"/"Editar"', () => {
    setSession('anon')
    const fetchMock = mockFetch({ status: 200, body: {} })
    renderArea(publicView({ origin: 'catalog' }))

    expect(screen.getByRole('link', { name: M.nav.signIn })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.editar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATH 1 + sessão PENDENTE: NADA renderizado (sem flash)', () => {
    setSession('pending')
    mockFetch({ status: 200, body: {} })
    const { container } = renderArea(publicView())

    expect(screen.queryByRole('button', { name: M.minhasCriacoes.editar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeNull()
    expect(screen.queryByRole('link', { name: M.nav.signIn })).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('PATH 1 + DONO mas fetch FALHA: degrada pra "Criar minha versão" (sem crash)', async () => {
    mockFetch({ reject: true })
    renderArea(publicView())

    expect(await screen.findByRole('button', { name: M.minhasCriacoes.criarMinhaVersao })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.minhasCriacoes.editar })).toBeNull()
  })
})

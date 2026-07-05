import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse, SearchResult } from '@/domain/recipe-search-read'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'

/**
 * Busca mesclada Receitas + Cozinheiros (#279) — integração jsdom no `SearchExperience`. O cluster de
 * Cozinheiros é um fetch PARALELO de /api/search/cooks (espelha a descoberta na web #164): aparece acima
 * das receitas quando casa alguém, some quando não; a lista de RECEITAS fica inalterada. `fetch` roteado
 * por URL (/api/search/cooks ANTES de /api/search — superset textual).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const MB = ptBR.busca
const MC = ptBR.buscaCozinheiros

const EMPTY: SearchResponse = { minhas: [], catalogo: [], comunidade: [] }

function recipe(recipeId: string, displayedTitle: string): SearchResult {
  return { recipeId, displayedTitle, origin: 'ai_chat', autoTranslationSignal: false, isOwn: false }
}
function cook(handle: string, name: string): ProfileFollowUser {
  return { handle, name, image: null }
}

/** Roteia fetch: /api/search/cooks → {cooks}; /api/search → search; /api/discovery/web → {results:[]}. */
function stubFetchRouting(search: SearchResponse, cooks: ProfileFollowUser[]) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/search/cooks')) return { ok: true, json: async () => ({ cooks }) }
    if (url.includes('/api/discovery/web')) return { ok: true, json: async () => ({ results: [] }) }
    return { ok: true, json: async () => search } // /api/search
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

function renderSearch() {
  sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <HomeSearchProvider>
        <HomeSearchBar />
        <SearchExperience />
      </HomeSearchProvider>
    </LocaleProvider>,
  )
}

function urlsHit(m: ReturnType<typeof vi.fn>): string[] {
  return m.mock.calls.map((c) => String(c[0]))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — cluster de Cozinheiros (#279)', () => {
  it('buscar termo que casa pessoa → cluster acima das receitas + lista de receitas inalterada', async () => {
    const search: SearchResponse = { minhas: [], catalogo: [], comunidade: [recipe('r1', 'Molho Alfredo')] }
    const fetchMock = stubFetchRouting(search, [cook('alfredo', 'Alfredo')])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'alfredo')

    // Cluster aparece com o cook.
    expect(await screen.findByRole('heading', { name: MC.titulo })).toBeInTheDocument()
    expect(screen.getByText('@alfredo')).toBeInTheDocument()
    // Disparou o fetch paralelo de cooks E a busca de receitas.
    await waitFor(() => expect(urlsHit(fetchMock).some((u) => u.includes('/api/search/cooks'))).toBe(true))
    expect(urlsHit(fetchMock).some((u) => u.includes('/api/search') && !u.includes('/api/search/cooks'))).toBe(true)
    // Lista de RECEITAS inalterada: a receita comunidade renderiza.
    expect(screen.getByText('Molho Alfredo')).toBeInTheDocument()
    // DOM: cluster ANTES da seção de receitas (flutua no topo).
    const clusterH = screen.getByRole('heading', { name: MC.titulo })
    const comunidadeH = screen.getByRole('heading', { name: MB.secaoComunidade })
    expect(clusterH.compareDocumentPosition(comunidadeH) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('termo sem pessoa (resposta cooks vazia) → SEM cluster', async () => {
    stubFetchRouting({ minhas: [], catalogo: [], comunidade: [recipe('r1', 'Pasta ao Sugo')] }, [])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'pasta')
    expect(await screen.findByText('Pasta ao Sugo')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('heading', { name: MC.titulo })).toBeNull()
  })

  it('cook casa mas ZERO receitas → cluster aparece E "nenhum resultado" NÃO aparece', async () => {
    stubFetchRouting(EMPTY, [cook('alfredo', 'Alfredo')])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'alfredo')
    expect(await screen.findByRole('heading', { name: MC.titulo })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(MB.semResultado)).toBeNull())
  })

  it('termo curto (< 3 chars) → NÃO chama /api/search/cooks (sem ruído)', async () => {
    const fetchMock = stubFetchRouting(EMPTY, [cook('ab', 'Ab')])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'ab')
    // espera o debounce do doSearch passar (a busca de receitas dispara; a de cooks NÃO)
    await waitFor(() =>
      expect(urlsHit(fetchMock).some((u) => u.includes('/api/search') && !u.includes('/api/search/cooks'))).toBe(true),
    )
    expect(urlsHit(fetchMock).some((u) => u.includes('/api/search/cooks'))).toBe(false)
    expect(screen.queryByRole('heading', { name: MC.titulo })).toBeNull()
  })

  it('apagar o termo pra < 3 chars LIMPA o cluster já mostrado (ramo else do gate)', async () => {
    stubFetchRouting(EMPTY, [cook('alfredo', 'Alfredo')])
    const user = userEvent.setup()
    renderSearch()
    const box = screen.getByRole('searchbox')
    await user.type(box, 'alfredo')
    expect(await screen.findByRole('heading', { name: MC.titulo })).toBeInTheDocument()
    // apaga até "al" (2 chars): hasCriteria ainda true (q não-vazio), mas cookTerm < 3 ⇒ aborta + limpa.
    await user.type(box, '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')
    await waitFor(() => expect(screen.queryByRole('heading', { name: MC.titulo })).toBeNull())
  })

  it('"Ver todos" expandido RESETA pra colapsado quando uma nova busca muda os cooks (key-remount)', async () => {
    const manyA = Array.from({ length: 5 }, (_, i) => cook(`a-${i}`, `Alfa ${i}`))
    const manyB = Array.from({ length: 5 }, (_, i) => cook(`b-${i}`, `Beta ${i}`))
    const fetchMock = vi.fn(async (input: unknown) => {
      const u = new URL(String(input), 'http://localhost')
      if (u.pathname.includes('/api/search/cooks')) {
        const term = u.searchParams.get('q') ?? ''
        return { ok: true, json: async () => ({ cooks: term.startsWith('beta') ? manyB : manyA }) }
      }
      if (String(input).includes('/api/discovery/web')) return { ok: true, json: async () => ({ results: [] }) }
      return { ok: true, json: async () => EMPTY }
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderSearch()
    const box = screen.getByRole('searchbox')

    await user.type(box, 'alfa')
    await screen.findByRole('heading', { name: MC.titulo })
    await user.click(await screen.findByRole('button', { name: MC.verTodos })) // expande
    expect(screen.getByRole('button', { name: MC.verMenos })).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'beta') // nova busca, cooks DIFERENTES ⇒ key muda ⇒ remonta colapsado
    await waitFor(() => expect(screen.getByText('@b-0')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: MC.verTodos })).toBeInTheDocument() // colapsado de novo
    expect(screen.queryByRole('button', { name: MC.verMenos })).toBeNull()
  })
})

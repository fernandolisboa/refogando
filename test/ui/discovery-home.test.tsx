import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse, SearchResult } from '@/domain/recipe-search-read'

/**
 * Home-Descoberta inline (#236, ADR-0020) — "a Descoberta é a home": o `SearchExperience` em REPOUSO
 * mostra o feed SSR SEEDADO (o crawler já o viu; o cliente o reflete) e a Busca refina INLINE a MESMA
 * superfície (não é tela separada). Ao buscar/filtrar, o estado vai pra URL (`router.replace`) →
 * recarregar com `?q=`/faceta cai no `noindex` do `generateMetadata`. Sem critério, a URL volta a
 * `/{locale}` (repouso) e o feed seeded reaparece.
 *
 * Seam jsdom (sem browser/Postgres). `fetch` mockado no shape REAL de `SearchResponse`; `router`
 * mockado pra capturar a reflexão da URL.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const routerReplace = vi.fn()
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}))

type SessionState = {
  data: unknown
  error: unknown
  isPending: boolean
  isRefetching: boolean
  refetch: () => void
}
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))
function anon(): SessionState {
  return { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const MF = ptBR.feed

/** Item de feed seeded (SSR) no shape de SearchResult. */
function feedItem(recipeId: string, displayedTitle: string, slug?: string): SearchResult {
  return {
    recipeId,
    displayedTitle,
    origin: 'catalog',
    autoTranslationSignal: false,
    isOwn: false,
    ...(slug ? { slug } : {}),
  }
}

function renderHome(over: { initialFeed?: SearchResult[]; initialNextCursor?: string | null } = {}) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <HomeSearchProvider>
        <HomeSearchBar />
        <SearchExperience
          home
          initialFeed={over.initialFeed ?? []}
          initialNextCursor={over.initialNextCursor ?? null}
        />
      </HomeSearchProvider>
    </LocaleProvider>,
  )
}

function stubFetchOk(body: SearchResponse) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  sessionState = anon()
  routerReplace.mockClear()
  routerPush.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience como home-Descoberta (#236)', () => {
  it('REPOUSO: monta com o feed SSR seeded visível (sem buscar nada)', async () => {
    renderHome({
      initialFeed: [feedItem('r1', 'Feijoada Seeded', 'feijoada-seeded'), feedItem('r2', 'Bolo Seeded', 'bolo-seeded')],
      initialNextCursor: null,
    })

    // O feed de repouso aparece SEM digitar nada (o crawler já o viu via SSR; o cliente o reflete).
    expect(screen.getByText('Feijoada Seeded')).toBeInTheDocument()
    expect(screen.getByText('Bolo Seeded')).toBeInTheDocument()
    // Link canônico por slug (#231).
    const fe = screen.getByText('Feijoada Seeded').closest('li')!
    expect(within(fe).getByRole('link')).toHaveAttribute('href', '/pt-BR/recipes/feijoada-seeded')
  })

  it('BUSCA INLINE: digitar reflete o termo na URL (router.replace com ?q=) — mesma superfície', async () => {
    stubFetchOk({ minhas: [], catalogo: [feedItem('r9', 'Resultado')], comunidade: [] })
    const user = userEvent.setup()
    renderHome({ initialFeed: [feedItem('r1', 'Feijoada Seeded')], initialNextCursor: null })

    await user.type(screen.getByRole('searchbox'), 'bolo')

    // O resultado da busca aparece (refino na MESMA tela)...
    await screen.findByText('Resultado')
    // ...e o estado foi refletido na URL (recarregar com ?q= cai no noindex do generateMetadata).
    const replaceCalls = routerReplace.mock.calls.map((c) => String(c[0]))
    expect(replaceCalls.some((u) => u.includes('q=bolo'))).toBe(true)
  })

  it('LIMPAR a busca: a URL volta pro repouso (sem params) e o feed seeded reaparece', async () => {
    stubFetchOk({ minhas: [], catalogo: [feedItem('r9', 'Resultado')], comunidade: [] })
    const user = userEvent.setup()
    renderHome({ initialFeed: [feedItem('r1', 'Feijoada Seeded')], initialNextCursor: null })

    const box = screen.getByRole('searchbox')
    await user.type(box, 'bolo')
    await screen.findByText('Resultado')

    routerReplace.mockClear()
    await user.clear(box)

    // De volta ao repouso: o feed seeded reaparece e a URL não carrega mais ?q=.
    await screen.findByText('Feijoada Seeded')
    const replaceCalls = routerReplace.mock.calls.map((c) => String(c[0]))
    // A última reflexão de URL NÃO tem o termo de busca (voltou ao repouso `/pt-BR`).
    expect(replaceCalls.at(-1) ?? '').not.toContain('q=bolo')
  })

  it('feed seeded VAZIO em repouso: mostra o estado neutro do feed (sem erro)', async () => {
    renderHome({ initialFeed: [], initialNextCursor: null })
    expect(screen.getByText(MF.vazio)).toBeInTheDocument()
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
  })

  it('repouso seeded NÃO chama /api/search (sem critério) — espelha o early-return', async () => {
    const fetchMock = stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderHome({ initialFeed: [feedItem('r1', 'Feijoada Seeded')], initialNextCursor: null })
    // Sem critério: nenhuma chamada à Busca (o feed veio do SSR).
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/search'))
    expect(searchCalls.length).toBe(0)
    expect(screen.getByText('Feijoada Seeded')).toBeInTheDocument()
  })
})

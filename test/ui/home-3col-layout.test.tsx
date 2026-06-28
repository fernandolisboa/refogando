import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

/**
 * Home/Busca em 3 colunas (ADR-0024 emendado) — integração jsdom. Verifica o gate do BLOCKER do
 * plan-review: a largura larga (`xl:max-w-wide`) + a 3ª coluna (trilho) só ligam quando o trilho VAI
 * pintar (logado + repouso + ≥MIN cozinheiros) — NUNCA p/ anon/SSR/<MIN (sem coluna fantasma; a home
 * indexável fica 2-col `reading`). Também: o trilho cai DEPOIS do feed no DOM (fim do feed abaixo de xl,
 * 3ª coluna em xl), a busca é UMA instância no header e o header alarga junto. jsdom não carrega CSS ⇒
 * asserts por CLASSE + ordem-DOM (a geometria responsiva fica pro browser).
 */

let pathnameMock = '/pt-BR'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathnameMock,
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
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState, signOut: vi.fn() }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'
import { SiteHeader } from '@/components/site-header'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'

const RAIL = ptBR.cozinheirosSugeridos.titulo
const FEED = ptBR.feed.titulo

const authed: SessionState = {
  data: { user: { id: 'u-1', name: 'Rita', email: 'rita@x.com', role: 'usuario', deletedAt: null } },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
}
const anon: SessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }

function rc(handle: string): RecommendedCook {
  return { handle, name: handle, image: null, recipeCount: 1, recipes: [] }
}

function stubFetch(cooks: RecommendedCook[]) {
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/discovery/cooks')) return { ok: true, json: async () => ({ cooks }) }
    return { ok: true, json: async () => ({ feed: [], nextCursor: null, results: [], minhas: [], catalogo: [], comunidade: [] }) }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', impl)
  return impl as unknown as ReturnType<typeof vi.fn>
}

function renderHome(session: SessionState) {
  sessionState = session
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <HomeSearchProvider>
        <SearchExperience home initialFeed={[]} initialNextCursor={null} />
      </HomeSearchProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pathnameMock = '/pt-BR'
})

describe('Home 3 colunas — gate do trilho + layout', () => {
  it('logado em repouso com ≥3 cozinheiros: trilho RENDERIZA (depois do feed) + layout largo (xl)', async () => {
    stubFetch([rc('rita'), rc('beto'), rc('ana')])
    const { container } = renderHome(authed)
    const railH = await screen.findByRole('heading', { name: RAIL })
    const feedH = screen.getByRole('heading', { name: FEED })
    // O trilho vem DEPOIS do feed no DOM (fim do feed abaixo de xl; 3ª coluna à direita em xl).
    expect(feedH.compareDocumentPosition(railH) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Largura larga + grade 3-col aplicadas (classes — jsdom não tem CSS).
    const main = container.querySelector('main')!
    expect(main.className).toContain('xl:max-w-wide')
    const grid = container.querySelector('[class*="grid-cols-1"]')!
    expect(grid.className).toContain('xl:grid-cols-[12.5rem')
    // O wrapper do trilho cai na 3ª coluna em xl (e abaixo da principal em lg) — pega um col-start errado.
    const railWrapper = railH.closest('section')!.parentElement!
    expect(railWrapper.className).toContain('xl:col-start-3')
    expect(railWrapper.className).toContain('lg:col-start-2')
  })

  it('Visitante (Modelo B): SEM trilho, SEM busca de cooks, layout 2-col reading (sem coluna fantasma)', async () => {
    const fetchMock = stubFetch([rc('a'), rc('b'), rc('c')])
    const { container } = renderHome(anon)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('heading', { name: RAIL })).toBeNull()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/discovery/cooks'))).toBe(false)
    const main = container.querySelector('main')!
    expect(main.className).not.toContain('xl:max-w-wide')
  })

  it('logado com 1 cozinheiro: trilho JÁ aparece + layout largo (sem piso de quantidade — dono 2026-06-28)', async () => {
    stubFetch([rc('rita')]) // 1 só já basta
    const { container } = renderHome(authed)
    expect(await screen.findByRole('heading', { name: RAIL })).toBeInTheDocument()
    expect(container.querySelector('main')!.className).toContain('xl:max-w-wide')
  })

  it('logado SEM cozinheiros (0): trilho OCULTO, layout 2-col (não mostra trilho vazio)', async () => {
    const fetchMock = stubFetch([]) // 0 ⇒ só este caso esconde
    const { container } = renderHome(authed)
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/discovery/cooks'))).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('heading', { name: RAIL })).toBeNull()
    expect(container.querySelector('main')!.className).not.toContain('xl:max-w-wide')
  })
})

describe('Home 3 colunas — busca no header (single instance + alarga junto)', () => {
  it('header na home: UMA caixa de busca + alarga (xl:max-w-wide) quando abre as 3 colunas', async () => {
    pathnameMock = '/pt-BR'
    stubFetch([rc('rita'), rc('beto'), rc('ana')])
    const { container } = render(
      <LocaleProvider initialLocale="pt-BR">
        <HomeSearchProvider>
          <SiteHeader />
          <SearchExperience home initialFeed={[]} initialNextCursor={null} />
        </HomeSearchProvider>
      </LocaleProvider>,
    )
    // UMA única caixa de busca (sem duplicar id/label no reflow do header).
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    // Ao carregar ≥3 cozinheiros, o header alarga junto p/ alinhar com as colunas do corpo.
    const headerInner = container.querySelector('header > div')!
    await waitFor(() => expect(headerInner.className).toContain('xl:max-w-wide'))
  })

  it('fora da home: o header NÃO mostra busca (sem 2ª linha fantasma)', () => {
    pathnameMock = '/pt-BR/following'
    stubFetch([])
    render(
      <LocaleProvider initialLocale="pt-BR">
        <HomeSearchProvider>
          <SiteHeader />
        </HomeSearchProvider>
      </LocaleProvider>,
    )
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})

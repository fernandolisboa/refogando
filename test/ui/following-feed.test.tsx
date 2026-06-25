import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { Origin } from '@/domain/recipe'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { FeedResponse } from '@/domain/recipe-feed-read'

/**
 * Feed SEGUINDO (#277) — `FollowingFeed`. Funde MyRecipesList (guard de sessão + fetch COM cookie +
 * reset por locale) e DiscoveryFeed (paginação por cursor). `fetch` mockado no shape de
 * `GET /api/feed/following` ({ feed, nextCursor }); `useSession`/`next/link` mockados (sem AppRouter/
 * Better Auth no jsdom); LocaleProvider real. Cobre: guest (precisa entrar), itens + paginação (COM
 * cookie — NÃO `credentials:'omit'`), empty state cause-neutro com ponte, erro, e o reset por troca
 * de locale (anti stale-cursor cross-locale).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider, useLocale } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { FollowingFeed } from '@/components/recipe/following-feed'

const M = ptBR.seguindoFeed
const MF = ptBR.feed

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false }
}
function pending(): SessionState {
  return { data: null, error: null, isPending: true }
}

function feedItem(recipeId: string, displayedTitle: string, origin: Origin = 'ai_structured'): SearchResult {
  return { recipeId, displayedTitle, origin, autoTranslationSignal: false, isOwn: false }
}

/** Mocka fetch; o handler decide ok/body por URL (locale/cursor). Devolve o spy. */
function mockFetch(handler: (url: URL, init: RequestInit) => { ok?: boolean; body?: FeedResponse }) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    const { ok = true, body = { feed: [], nextCursor: null } } = handler(url, init ?? {})
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}
function lastFetchUrl(m: ReturnType<typeof vi.fn>): string {
  return String(m.mock.calls.at(-1)?.[0])
}
function lastFetchInit(m: ReturnType<typeof vi.fn>): RequestInit {
  return (m.mock.calls.at(-1)?.[1] ?? {}) as RequestInit
}

function renderFollowing(session: SessionState) {
  sessionState = session
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <FollowingFeed />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FollowingFeed (#277)', () => {
  it('Visitante: mostra "entre para ver" + link de login, sem buscar', () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    renderFollowing(guest())

    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('sessão pendente: mostra loading, sem buscar', () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    renderFollowing(pending())

    expect(screen.getByText(ptBR.system.loading)).toBeInTheDocument()
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('logado: busca página 1 e pagina (APPEND por cursor) — COM cookie (NÃO credentials:omit)', async () => {
    const fetchMock = mockFetch((url) => {
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) return { body: { feed: [feedItem('r1', 'Pública de A')], nextCursor: 'C1' } }
      return { body: { feed: [feedItem('r2', 'Pública de B', 'ai_chat')], nextCursor: null } }
    })
    const user = userEvent.setup()
    renderFollowing(authed())

    // Página 1 (busca no mount, COM cookie): a 1ª URL bate /api/feed/following e NÃO é credentials:omit.
    await screen.findByText('Pública de A')
    const firstUrl = new URL(String(fetchMock.mock.calls.at(0)?.[0]))
    expect(firstUrl.pathname).toBe('/api/feed/following')
    expect((fetchMock.mock.calls.at(0)?.[1] as RequestInit | undefined)?.credentials).toBeUndefined()

    // Paginação: "Carregar mais" → APPEND, mandando o cursor da página anterior.
    await user.click(screen.getByRole('button', { name: MF.carregarMais }))
    await screen.findByText('Pública de B')
    expect(screen.getByText('Pública de A')).toBeInTheDocument() // append, não substitui
    const url = new URL(lastFetchUrl(fetchMock))
    expect(url.pathname).toBe('/api/feed/following')
    expect(url.searchParams.get('cursor')).toBe('C1')
    expect(lastFetchInit(fetchMock).credentials).toBeUndefined() // per-viewer: cookie nativo

    // Fim: botão some, "fim" aparece.
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
    expect(screen.getByText(MF.fim)).toBeInTheDocument()
  })

  it('logado SEM nada no feed: empty state cause-neutro (h2) + CTA "Explorar receitas" → /', async () => {
    mockFetch(() => ({ body: { feed: [], nextCursor: null } }))
    renderFollowing(authed())

    const heading = await screen.findByRole('heading', { name: M.vazioTitulo })
    expect(heading.tagName).toBe('H2')
    expect(screen.getByText(M.vazioCorpo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: M.vazioCta })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
  })

  it('logado + fetch falha → erro ANUNCIADO', async () => {
    mockFetch(() => ({ ok: false }))
    renderFollowing(authed())
    await screen.findByText(ptBR.system.error)
  })

  it('troca de locale RESETA a lista e refaz a página 1 no novo idioma (anti stale-cursor)', async () => {
    const fetchMock = mockFetch((url) => {
      const loc = url.searchParams.get('locale')
      return loc === 'en-US'
        ? { body: { feed: [feedItem('en1', 'English recipe')], nextCursor: null } }
        : { body: { feed: [feedItem('pt1', 'Receita em PT')], nextCursor: 'C1' } }
    })
    const user = userEvent.setup()

    function Harness() {
      const { setLocale } = useLocale()
      return (
        <div>
          <button onClick={() => setLocale('en-US')}>flip</button>
          <FollowingFeed />
        </div>
      )
    }
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <Harness />
      </LocaleProvider>,
    )

    await screen.findByText('Receita em PT')
    await user.click(screen.getByRole('button', { name: 'flip' }))

    // Após a troca: a lista do idioma antigo SOME e a página 1 do novo idioma aparece (reset atômico).
    await screen.findByText('English recipe')
    expect(screen.queryByText('Receita em PT')).not.toBeInTheDocument()
    const lastUrl = new URL(lastFetchUrl(fetchMock))
    expect(lastUrl.searchParams.get('locale')).toBe('en-US')
    expect(lastUrl.searchParams.get('cursor')).toBeNull() // página 1 (reset), não a 2 do locale antigo
    // sanity: o catálogo en-US existe (paridade) — guard contra import morto
    expect(enUS.seguindoFeed.titulo).toBe('Following')
  })
})

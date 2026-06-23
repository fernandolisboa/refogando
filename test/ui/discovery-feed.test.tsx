import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { Origin } from '@/domain/recipe'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { FeedResponse } from '@/domain/recipe-feed-read'

/**
 * Feed da Descoberta-home (#236) — `DiscoveryFeed`, sucessor do `RecipeFeedExperience` (#103). Mantém
 * a mecânica de paginação por cursor que migrou pra cá quando o índice `/recipes` fundiu na home, mas
 * SEEDADA: a 1ª página vem como prop (`initialItems`/`initialNextCursor`, do SSR anônimo) — só páginas
 * 2+ batem o `/api/feed`. Este teste cobre o que a deleção de `test/ui/recipes-feed.test.tsx` regrediu:
 *
 *  (a) "Carregar mais" APPEND por cursor (não substitui), mandando o `cursor` da página anterior;
 *  (b) FIM quando `nextCursor` vira null (botão some, "fim" aparece);
 *  (c) ERRO quando o fetch do loadMore falha (anunciado, itens preservados, botão segue);
 *  (d) o fetch do loadMore vai SEM credenciais (`credentials: 'omit'`) — bate com o SSR anônimo da
 *      página 1, pra um LOGADO não receber as próprias privadas no meio do stream (contrato indexável).
 *
 * `DiscoveryFeed` NÃO usa `useSession`/`useRouter` (é presentational + paginação); só `useLocale`,
 * provido pelo `LocaleProvider`. `next/link` → `<a>` simples (sem AppRouterContext no jsdom).
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
import { DiscoveryFeed } from '@/components/recipe/discovery-feed'

const M = ptBR.busca
const MF = ptBR.feed

function feedItem(recipeId: string, displayedTitle: string, origin: Origin = 'catalog'): SearchResult {
  return { recipeId, displayedTitle, origin, autoTranslationSignal: false, isOwn: false }
}

function renderFeed(initialItems: SearchResult[], initialNextCursor: string | null) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <DiscoveryFeed initialItems={initialItems} initialNextCursor={initialNextCursor} />
    </LocaleProvider>,
  )
}

/** Mocka fetch resolvendo respostas OK em SEQUÊNCIA (a i-ésima chamada devolve bodies[i]). */
function stubFetchSequence(bodies: FeedResponse[]) {
  let i = 0
  const fetchMock = vi.fn(async () => {
    const body = bodies[Math.min(i, bodies.length - 1)]
    i += 1
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

function lastFetchUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls.at(-1)?.[0])
}
function lastFetchInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls.at(-1)?.[1] ?? {}) as RequestInit
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DiscoveryFeed (#236) — feed seeded + paginação', () => {
  it('D0 — seeded: lista a 1ª página SEM fetch; botão "Carregar mais" presente quando há cursor', () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    renderFeed([feedItem('r1', 'Feijoada'), feedItem('r2', 'Strogonoff', 'ai_chat')], 'CURSOR1')

    // A 1ª página veio seeded — nenhum fetch ao montar.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    // Selos de proveniência + cursor presente ⇒ botão "Carregar mais".
    const fe = screen.getByText('Feijoada').closest('li')!
    expect(within(fe).getByText(M.seloCatalogo)).toBeInTheDocument()
    expect(within(fe).getByRole('link')).toHaveAttribute('href', '/pt-BR/recipes/r1')
    expect(screen.getByRole('button', { name: MF.carregarMais })).toBeInTheDocument()
    expect(screen.queryByText(MF.fim)).not.toBeInTheDocument()
  })

  it('D1 (a+b) — "Carregar mais" APPEND por cursor até o fim (nextCursor null)', async () => {
    const fetchMock = stubFetchSequence([
      { feed: [feedItem('r2', 'Strogonoff', 'ai_chat')], nextCursor: null },
    ])
    const user = userEvent.setup()
    renderFeed([feedItem('r1', 'Feijoada')], 'CURSOR1')

    await user.click(screen.getByRole('button', { name: MF.carregarMais }))

    // 2ª página chega: APPEND (os dois itens visíveis), e o fetch mandou o cursor da pág. anterior.
    await screen.findByText('Strogonoff')
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    const url = new URL(lastFetchUrl(fetchMock))
    expect(url.pathname).toBe('/api/feed')
    expect(url.searchParams.get('cursor')).toBe('CURSOR1')
    expect(url.searchParams.get('locale')).toBe('pt-BR')

    // Fim: botão some, "fim" aparece.
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
    expect(screen.getByText(MF.fim)).toBeInTheDocument()
  })

  it('D2 (d) — o fetch do loadMore vai SEM credenciais (credentials: "omit") — bate com o SSR anônimo', async () => {
    const fetchMock = stubFetchSequence([{ feed: [feedItem('r2', 'Bolo')], nextCursor: null }])
    const user = userEvent.setup()
    renderFeed([feedItem('r1', 'Feijoada')], 'CURSOR1')

    await user.click(screen.getByRole('button', { name: MF.carregarMais }))
    await screen.findByText('Bolo')

    // O contrato indexável: paginação anônima (sem cookie de sessão) — um LOGADO não recebe as próprias
    // privadas no meio do stream. Se o `credentials: 'omit'` sumir, este teste fica vermelho.
    expect(lastFetchInit(fetchMock).credentials).toBe('omit')
  })

  it('D3 (c) — falha no loadMore → erro ANUNCIADO, itens preservados, botão segue (retry)', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderFeed([feedItem('r1', 'Feijoada')], 'CURSOR1')

    await user.click(screen.getByRole('button', { name: MF.carregarMais }))

    // Erro anunciado; o item seeded PERMANECE; o botão segue presente (não encalha).
    await screen.findByText(ptBR.system.error)
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: MF.carregarMais })).toBeInTheDocument()
    expect(call).toBe(1)
  })

  it('D4 — seeded VAZIO + sem cursor → estado neutro do feed (vazio), sem botão nem fim', () => {
    renderFeed([], null)
    expect(screen.getByText(MF.vazio)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
    expect(screen.queryByText(MF.fim)).not.toBeInTheDocument()
  })
})

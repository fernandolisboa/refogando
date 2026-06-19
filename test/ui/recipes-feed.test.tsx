import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { Origin } from '@/domain/recipe'
import type { FeedResponse } from '@/domain/recipe-feed-read'

// next/link → <a> simples (sem AppRouterContext no jsdom). Espelha test/ui/search.test.tsx.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #116: o feed agora lê useSession só para escolher o SUBTÍTULO (anônimo vs logado). Sem mock,
// o hook tentaria buscar /api/auth/get-session (quebra no jsdom). Estado MUTÁVEL por teste:
// anônimo por padrão (data=null); o teste de cópia-logada troca para `authed()`.
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
function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}
beforeEach(() => {
  sessionState = anon()
})

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeFeedExperience } from '@/components/recipe/recipe-feed-experience'

/**
 * Teste de COMPONENTE jsdom do feed /recipes (#103) — seam de frontend (#54). Cobre: monta →
 * busca /api/feed (sem cursor) → lista plana + selos + links; feed vazio; scroll infinito via
 * "Carregar mais" (jsdom não tem IntersectionObserver → o botão é o trigger) com paginação por
 * cursor (append, não substitui) até o fim; erro + retry. `fetch` mockado no shape REAL de
 * `FeedResponse`, respostas em SEQUÊNCIA (uma por página).
 */

const M = ptBR.busca
const MF = ptBR.feed

function renderFeed() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeFeedExperience />
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

function item(recipeId: string, displayedTitle: string, origin: Origin = 'catalog') {
  return { recipeId, displayedTitle, origin, autoTranslationSignal: false }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeFeedExperience (#103)', () => {
  it('F1 — monta e lista o feed plano (/api/feed sem cursor) → itens + selos + links; fim sem mais', async () => {
    const fetchMock = stubFetchSequence([
      { feed: [item('r1', 'Feijoada', 'catalog'), item('r2', 'Strogonoff', 'ai_chat')], nextCursor: null },
    ])
    renderFeed()

    await screen.findByText('Feijoada')

    const url = new URL(lastFetchUrl(fetchMock))
    expect(url.pathname).toBe('/api/feed')
    expect(url.searchParams.get('locale')).toBe('pt-BR')
    expect(url.searchParams.get('cursor')).toBeNull()

    // Selos de proveniência + links para o detalhe canônico.
    const fe = screen.getByText('Feijoada').closest('li')!
    expect(within(fe).getByText(M.seloCatalogo)).toBeInTheDocument()
    expect(within(fe).getByRole('link')).toHaveAttribute('href', '/recipes/r1')
    const st = screen.getByText('Strogonoff').closest('li')!
    expect(within(st).getByText(M.seloComunidade)).toBeInTheDocument()

    // nextCursor null ⇒ fim do feed; sem botão "Carregar mais".
    expect(screen.getByText(MF.fim)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
  })

  it('F2 — feed vazio → estado neutro, sem erro', async () => {
    stubFetchSequence([{ feed: [], nextCursor: null }])
    renderFeed()

    await screen.findByText(MF.vazio)
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
    expect(screen.queryByText(MF.fim)).not.toBeInTheDocument()
  })

  it('F3 — scroll infinito: "Carregar mais" pagina por cursor (append) até o fim', async () => {
    const fetchMock = stubFetchSequence([
      { feed: [item('r1', 'Feijoada', 'catalog')], nextCursor: 'CURSOR1' },
      { feed: [item('r2', 'Strogonoff', 'ai_chat')], nextCursor: null },
    ])
    const user = userEvent.setup()
    renderFeed()

    await screen.findByText('Feijoada')
    // Há próxima página: botão presente, fim ainda não.
    const more = screen.getByRole('button', { name: MF.carregarMais })
    expect(screen.queryByText(MF.fim)).not.toBeInTheDocument()

    await user.click(more)

    // 2ª chamada manda cursor=CURSOR1.
    await screen.findByText('Strogonoff')
    expect(new URL(lastFetchUrl(fetchMock)).searchParams.get('cursor')).toBe('CURSOR1')

    // Append (não substitui): os DOIS itens visíveis.
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    expect(screen.getByText('Strogonoff')).toBeInTheDocument()

    // Fim alcançado: botão some, "fim" aparece.
    expect(screen.queryByRole('button', { name: MF.carregarMais })).not.toBeInTheDocument()
    expect(screen.getByText(MF.fim)).toBeInTheDocument()
  })

  it('F4 — erro na 1ª página → erro + retry recupera', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', failing)

    renderFeed()

    await screen.findByText(ptBR.system.error)
    const retry = screen.getByRole('button', { name: ptBR.system.retry })

    stubFetchSequence([{ feed: [item('r1', 'Feijoada', 'catalog')], nextCursor: null }])
    const user = userEvent.setup()
    await user.click(retry)

    await screen.findByText('Feijoada')
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
  })

  it('F5 — falha ao carregar MAIS → erro visível, itens preservados, botão segue (retry)', async () => {
    // 1ª página OK (com nextCursor); a carga seguinte falha.
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return { ok: true, json: async () => ({ feed: [item('r1', 'Feijoada', 'catalog')], nextCursor: 'C1' }) }
      }
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderFeed()

    await screen.findByText('Feijoada')
    await user.click(screen.getByRole('button', { name: MF.carregarMais }))

    // Falha de "carregar mais" é ANUNCIADA (não silenciosa); o item já carregado PERMANECE; e o
    // botão segue presente para tentar de novo (não encalha).
    await screen.findByText(ptBR.system.error)
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: MF.carregarMais })).toBeInTheDocument()
  })

  it('F6 (#116) — anônimo vê o subtítulo de COMUNIDADE; não o de "suas receitas"', async () => {
    sessionState = anon()
    stubFetchSequence([{ feed: [item('r1', 'Feijoada', 'catalog')], nextCursor: null }])
    renderFeed()

    await screen.findByText('Feijoada')
    expect(screen.getByText(MF.subtitulo)).toBeInTheDocument()
    expect(screen.queryByText(MF.subtituloLogado)).not.toBeInTheDocument()
  })

  it('F7 (#116) — LOGADO: subtítulo "suas receitas + comunidade" E a própria privada renderiza', async () => {
    sessionState = authed()
    // A linha PRIVADA do dono chega no payload do /api/feed (o gate do servidor a inclui p/ o
    // viewer); a UI a renderiza como qualquer item (selo de comunidade — o DTO não carrega
    // visibility; o importante é NÃO quebrar). Modela "private own row renders".
    stubFetchSequence([
      {
        feed: [item('rPriv', 'Minha Privada', 'ai_chat'), item('rCat', 'Feijoada', 'catalog')],
        nextCursor: null,
      },
    ])
    renderFeed()

    await screen.findByText('Minha Privada')
    // Cópia autenticada (key-path idêntica entre locales).
    expect(screen.getByText(MF.subtituloLogado)).toBeInTheDocument()
    expect(screen.queryByText(MF.subtitulo)).not.toBeInTheDocument()
    // A própria privada renderiza sem quebrar, com link para o detalhe canônico.
    const priv = screen.getByText('Minha Privada').closest('li')!
    expect(within(priv).getByRole('link')).toHaveAttribute('href', '/recipes/rPriv')
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
  })
})

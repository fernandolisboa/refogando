import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom dos controles de Engajamento da Comunidade (#62) — seam de
 * frontend da #54 (sem browser/Postgres). `fetch` é mockado no SHAPE REAL e DISJUNTO das
 * rotas (vote/unvote ⇒ `{voteCount, viewerVoted}`; favorite/unfavorite ⇒ `{viewerFavorited}`
 * SÓ). `next/link` é mockado; o locale é real. O componente NÃO usa `useRouter`: o corpo
 * do POST é autoritativo e nada na page deriva de voto/favorito, então não há
 * `router.refresh()` (round-trip full-page descartado) a mockar/assertar.
 * (LocaleProvider). Cobre AC1 (botões no detalhe), AC2 (não-autovoto na UI via canManage),
 * AC4 (estado visível quando autenticado), favorito-anônimo, dono-no-pool, e a robustez
 * (otimismo → reversão no erro, sem âmbar).
 *
 * ADR-0015: ÂMBAR (`aviso-*`) e accent (`accent`/`accent-surface`) são PROIBIDOS aqui —
 * provamos a ausência pela AUSÊNCIA dessas classes em TODO o componente.
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
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { RecipeEngagementControls } from '@/components/recipe/recipe-engagement-controls'

const M = ptBR.comunidade

type FetchResult = { status: number; body: unknown } | { reject: true }

/** Mocka `fetch` por URL; opcionalmente pendura a resposta via factory (loading sem corrida). */
function mockFetch(result: FetchResult | (() => Promise<FetchResult>)) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (!url.includes('/api/recipes/')) throw new Error(`fetch não mockado: ${url}`)
    const r = typeof result === 'function' ? await result() : result
    if ('reject' in r) throw new TypeError('network down')
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

/** Alça p/ pendurar a resposta do POST e liberá-la depois (estado loading determinístico). */
function deferred() {
  let release!: (r: FetchResult) => void
  const factory = () => new Promise<FetchResult>((res) => (release = res))
  return { factory, release: (r: FetchResult) => release(r) }
}

type Props = {
  initialVoteCount?: number
  initialViewerVoted?: boolean
  initialViewerFavorited?: boolean
  canManage?: boolean
  locale?: Locale
}

function renderControls(opts: Props = {}) {
  const {
    initialVoteCount,
    initialViewerVoted,
    initialViewerFavorited,
    canManage = false,
    locale = 'pt-BR',
  } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEngagementControls
        recipeId="r-1"
        initialVoteCount={initialVoteCount}
        initialViewerVoted={initialViewerVoted}
        initialViewerFavorited={initialViewerFavorited}
        canManage={canManage}
      />
    </LocaleProvider>,
  )
}

/** Garante ausência de âmbar (`aviso-*`) e de accent (Catálogo) — ADR-0015. */
function semCorReservada(container: HTMLElement) {
  expect(container.querySelector('[class*="aviso"]')).toBeNull()
  expect(container.querySelector('[class*="accent"]')).toBeNull()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeEngagementControls (#62)', () => {
  it('T1 — votar (autenticado, 200): botão alterna, contagem sobe (plural)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { voteCount: 4, viewerVoted: true } })
    renderControls({ initialVoteCount: 3, initialViewerVoted: false, initialViewerFavorited: false })

    expect(screen.getByText('3 votos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.votar }))

    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1/vote')
    expect((call[1] as RequestInit).method).toBe('POST')

    const votado = await screen.findByRole('button', { name: M.votado })
    expect(votado).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('4 votos')).toBeInTheDocument()
  })

  it('T2 — desfazer voto (200): contagem cai a 1 (SINGULAR), botão volta a "Votar"', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { voteCount: 1, viewerVoted: false } })
    renderControls({ initialVoteCount: 2, initialViewerVoted: true, initialViewerFavorited: false })

    expect(screen.getByText('2 votos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.votado }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/unvote')
    const votar = await screen.findByRole('button', { name: M.votar })
    expect(votar).toHaveAttribute('aria-pressed', 'false')
    // Pluralização: 1 → SINGULAR.
    expect(screen.getByText('1 voto')).toBeInTheDocument()
    expect(screen.queryByText('1 votos')).not.toBeInTheDocument()
  })

  it('T3 — favoritar (200) NÃO regride voto/contagem (shapes disjuntos)', async () => {
    const user = userEvent.setup()
    // /favorite devolve SÓ {viewerFavorited} — nunca voteCount/viewerVoted.
    const fetchMock = mockFetch({ status: 200, body: { viewerFavorited: true } })
    renderControls({ initialVoteCount: 5, initialViewerVoted: true, initialViewerFavorited: false })

    await user.click(screen.getByRole('button', { name: M.favoritar }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/favorite')
    const favoritado = await screen.findByRole('button', { name: M.favoritado })
    expect(favoritado).toHaveAttribute('aria-pressed', 'true')

    // Voto INTACTO: continua "Votado", aria-pressed=true, contagem "5 votos".
    const votado = screen.getByRole('button', { name: M.votado })
    expect(votado).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('5 votos')).toBeInTheDocument()
  })

  it('T4 — DONO (canManage) não vê botão de voto, mas vê favoritar', () => {
    renderControls({ canManage: true, initialVoteCount: 5, initialViewerVoted: false, initialViewerFavorited: false })

    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votado })).toBeNull()
    expect(screen.getByRole('button', { name: M.favoritar })).toBeInTheDocument()
  })

  it('T-dono-pool — dono no pool: contagem read-only + favoritar FUNCIONAL', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { viewerFavorited: true } })
    renderControls({ canManage: true, initialVoteCount: 5, initialViewerVoted: false, initialViewerFavorited: false })

    // Contagem read-only VISÍVEL; botão de voto AUSENTE.
    expect(screen.getByText('5 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()

    // Favoritar PRESENTE e FUNCIONAL (dono pode favoritar a própria).
    await user.click(screen.getByRole('button', { name: M.favoritar }))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/favorite')
    expect(await screen.findByRole('button', { name: M.favoritado })).toBeInTheDocument()
  })

  it('T5 — ANÔNIMO: dois links /sign-in, contagem read-only, sem botão, sem fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: {} })
    // Sem viewerVoted/viewerFavorited ⇒ anônimo; voteCount presente (pool).
    renderControls({ initialVoteCount: 5, canManage: false })

    const votoLink = screen.getByRole('link', { name: M.convidaEntrarVoto })
    const favLink = screen.getByRole('link', { name: M.convidaEntrarFavorito })
    expect(votoLink).toHaveAttribute('href', '/sign-in')
    expect(favLink).toHaveAttribute('href', '/sign-in')

    expect(screen.getByText('5 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votado })).toBeNull()
    expect(screen.queryByRole('button', { name: M.favoritar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.favoritado })).toBeNull()

    // Clicar em qualquer link NÃO toca a API (anônimo).
    await user.click(votoLink)
    await user.click(favLink)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T6 — erro no voto: OTIMISMO → REVERSÃO + alerta neutro, sem âmbar/accent', async () => {
    const user = userEvent.setup()
    const d = deferred()
    mockFetch(d.factory)
    const { container } = renderControls({
      initialVoteCount: 2,
      initialViewerVoted: false,
      initialViewerFavorited: false,
    })

    await user.click(screen.getByRole('button', { name: M.votar }))

    // Estado OTIMISTA enquanto pendente: vira "Votado", aria-pressed=true, contagem 3, busy.
    const otimista = screen.getByRole('button', { name: M.votado })
    expect(otimista).toHaveAttribute('aria-pressed', 'true')
    expect(otimista).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('3 votos')).toBeInTheDocument()

    // Servidor recusa (422 auto_voto = defesa em profundidade) ⇒ REVERSÃO.
    d.release({ status: 422, body: { error: 'auto_voto' } })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.erroVoto)
    const revertido = screen.getByRole('button', { name: M.votar })
    expect(revertido).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('2 votos')).toBeInTheDocument()
    semCorReservada(container)
  })

  it('T7 — en-US: rótulos traduzidos', () => {
    renderControls({
      locale: 'en-US',
      initialVoteCount: 1,
      initialViewerVoted: false,
      initialViewerFavorited: false,
    })
    expect(screen.getByRole('button', { name: enUS.comunidade.votar })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.comunidade.favoritar })).toBeInTheDocument()
    // Pluralização en-US: 1 → singular "1 vote".
    expect(screen.getByText('1 vote')).toBeInTheDocument()
  })
})

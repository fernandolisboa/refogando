import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom dos controles de Engajamento da Comunidade (#62) — seam de
 * frontend da #54 (sem browser/Postgres). `fetch` é mockado no SHAPE REAL e DISJUNTO das
 * rotas (vote/unvote ⇒ `{voteCount, viewerVoted}`; save/unsave ⇒ `{viewerSaved}`
 * SÓ). `next/link` é mockado; o locale é real. O componente NÃO usa `useRouter`: o corpo
 * do POST é autoritativo e nada na page deriva de voto/save, então não há
 * `router.refresh()` (round-trip full-page descartado) a mockar/assertar.
 * (LocaleProvider). Cobre AC1 (botões no detalhe), AC2 (não-autovoto na UI via canManage),
 * AC4 (estado visível quando autenticado), save-anônimo, dono-no-pool, e a robustez
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

// `useSession` (#230 follow-up): o componente agora resolve o estado do viewer no cliente quando o
// caminho público não o entregou. Mockamos o cliente Better Auth com uma sessão controlável por teste.
const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

/** Define o estado da sessão mockada antes do render. */
function setSession(state: 'logged-in' | 'anon' | 'pending') {
  authMock.session =
    state === 'logged-in'
      ? { data: { user: { id: 'u1' } }, isPending: false, error: null }
      : state === 'anon'
        ? { data: null, isPending: false, error: null }
        : { data: null, isPending: true, error: null }
}

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
  initialViewerSaved?: boolean
  canManage?: boolean
  locale?: Locale
}

function renderControls(opts: Props = {}) {
  const {
    initialVoteCount,
    initialViewerVoted,
    initialViewerSaved,
    canManage = false,
    locale = 'pt-BR',
  } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEngagementControls
        recipeId="r-1"
        initialVoteCount={initialVoteCount}
        initialViewerVoted={initialViewerVoted}
        initialViewerSaved={initialViewerSaved}
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

beforeEach(() => {
  // Default: LOGADO. Os testes de caminho do DONO (estado do viewer vem por prop ⇒ `serverResolved`)
  // não disparam fetch nem dependem disto; os de caminho público sobrescrevem por teste.
  setSession('logged-in')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeEngagementControls (#62)', () => {
  it('T1 — votar (autenticado, 200): botão alterna, contagem sobe (plural)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { voteCount: 4, viewerVoted: true } })
    renderControls({ initialVoteCount: 3, initialViewerVoted: false, initialViewerSaved: false })

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
    renderControls({ initialVoteCount: 2, initialViewerVoted: true, initialViewerSaved: false })

    expect(screen.getByText('2 votos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.votado }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/unvote')
    const votar = await screen.findByRole('button', { name: M.votar })
    expect(votar).toHaveAttribute('aria-pressed', 'false')
    // Pluralização: 1 → SINGULAR.
    expect(screen.getByText('1 voto')).toBeInTheDocument()
    expect(screen.queryByText('1 votos')).not.toBeInTheDocument()
  })

  it('T3 — salvar (200) NÃO regride voto/contagem (shapes disjuntos)', async () => {
    const user = userEvent.setup()
    // /save devolve SÓ {viewerSaved} — nunca voteCount/viewerVoted.
    const fetchMock = mockFetch({ status: 200, body: { viewerSaved: true } })
    renderControls({ initialVoteCount: 5, initialViewerVoted: true, initialViewerSaved: false })

    await user.click(screen.getByRole('button', { name: M.salvar }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/save')
    const salvo = await screen.findByRole('button', { name: M.salvo })
    expect(salvo).toHaveAttribute('aria-pressed', 'true')

    // Voto INTACTO: continua "Votado", aria-pressed=true, contagem "5 votos".
    const votado = screen.getByRole('button', { name: M.votado })
    expect(votado).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('5 votos')).toBeInTheDocument()
  })

  it('T4 — DONO (canManage) não vê botão de voto, mas vê salvar', () => {
    renderControls({ canManage: true, initialVoteCount: 5, initialViewerVoted: false, initialViewerSaved: false })

    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votado })).toBeNull()
    expect(screen.getByRole('button', { name: M.salvar })).toBeInTheDocument()
  })

  it('T-dono-pool — dono no pool: contagem read-only + salvar FUNCIONAL', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { viewerSaved: true } })
    renderControls({ canManage: true, initialVoteCount: 5, initialViewerVoted: false, initialViewerSaved: false })

    // Contagem read-only VISÍVEL; botão de voto AUSENTE.
    expect(screen.getByText('5 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()

    // Salvar PRESENTE e FUNCIONAL (dono pode salvar a própria).
    await user.click(screen.getByRole('button', { name: M.salvar }))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/save')
    expect(await screen.findByRole('button', { name: M.salvo })).toBeInTheDocument()
  })

  it('T5 — ANÔNIMO: dois links /sign-in, contagem read-only, sem botão, sem fetch', async () => {
    const user = userEvent.setup()
    setSession('anon')
    const fetchMock = mockFetch({ status: 200, body: {} })
    // Sem viewerVoted/viewerSaved (caminho público) + sessão anônima ⇒ convite a entrar.
    renderControls({ initialVoteCount: 5, canManage: false })

    const votoLink = screen.getByRole('link', { name: M.convidaEntrarVoto })
    const favLink = screen.getByRole('link', { name: M.convidaEntrarSalvar })
    expect(votoLink).toHaveAttribute('href', '/sign-in')
    expect(favLink).toHaveAttribute('href', '/sign-in')

    expect(screen.getByText('5 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votado })).toBeNull()
    expect(screen.queryByRole('button', { name: M.salvar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.salvo })).toBeNull()

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
      initialViewerSaved: false,
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
      initialViewerSaved: false,
    })
    expect(screen.getByRole('button', { name: enUS.comunidade.votar })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.comunidade.salvar })).toBeInTheDocument()
    // Pluralização en-US: 1 → singular "1 vote".
    expect(screen.getByText('1 vote')).toBeInTheDocument()
  })

  // ── Caminho PÚBLICO/cacheável (#230, ADR-0020): server NÃO entrega estado do viewer (lê anônimo).
  //    O componente o resolve NO CLIENTE via GET /api/recipes/[id]/social quando logado. Este era o
  //    bug: logado via sempre "Entrar para votar/salvar". ────────────────────────────────────────

  it('T8 — LOGADO no caminho público: GET /social hidrata voto/save reais (sem convite)', async () => {
    setSession('logged-in')
    // Sem initialViewer* ⇒ caminho público; o fetch resolve o estado do PRÓPRIO viewer.
    const fetchMock = mockFetch({
      status: 200,
      body: { viewerVoted: true, viewerSaved: false, isOwner: false },
    })
    renderControls({ initialVoteCount: 5 })

    // Hidrata: voto vira "Votado" (aria-pressed), salvar disponível e NÃO-pressionado.
    const votado = await screen.findByRole('button', { name: M.votado })
    expect(votado).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: M.salvar })).toHaveAttribute('aria-pressed', 'false')

    // Bateu no endpoint certo (estado do viewer), via GET (sem method).
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/social')

    // O BUG: NÃO mostra mais o convite "Entrar para..." pra quem está logado.
    expect(screen.queryByRole('link', { name: M.convidaEntrarVoto })).toBeNull()
    expect(screen.queryByRole('link', { name: M.convidaEntrarSalvar })).toBeNull()
  })

  it('T9 — LOGADO DONO no caminho público (isOwner): esconde voto, salvar funcional', async () => {
    setSession('logged-in')
    mockFetch({ status: 200, body: { viewerVoted: false, viewerSaved: true, isOwner: true } })
    renderControls({ initialVoteCount: 5 })

    // Save hidratado (dono pode salvar a própria).
    expect(await screen.findByRole('button', { name: M.salvo })).toBeInTheDocument()
    // Voto AUSENTE: dono não vota na própria (AC2), descoberto pelo `isOwner` do fetch.
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votado })).toBeNull()
    // Contagem read-only permanece visível.
    expect(screen.getByText('5 votos')).toBeInTheDocument()
  })

  it('T10 — sessão PENDENTE no caminho público: nem convite nem botões (só contagem), sem fetch', () => {
    setSession('pending')
    const fetchMock = mockFetch({ status: 200, body: {} })
    renderControls({ initialVoteCount: 5 })

    // Contagem read-only fica; nada de flash de "Entrar" nem de botões enquanto a sessão pende.
    expect(screen.getByText('5 votos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.convidaEntrarVoto })).toBeNull()
    expect(screen.queryByRole('button', { name: M.votar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.salvar })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T11 — GET /social FALHA (logado): degrada pra botões interativos (defaults), nunca convite', async () => {
    setSession('logged-in')
    mockFetch({ reject: true })
    renderControls({ initialVoteCount: 5 })

    // Degradação graciosa: botões interativos com defaults (não-votado/não-salvo), nunca o
    // convite "Entrar" (o usuário está logado) nem crash. O server corrige no clique.
    const votar = await screen.findByRole('button', { name: M.votar })
    expect(votar).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: M.salvar })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.convidaEntrarVoto })).toBeNull()
  })

  it('T12 — LOGADO via caminho público hidratado: clicar VOTA de fato (POST /vote)', async () => {
    const user = userEvent.setup()
    setSession('logged-in')
    // Mock por URL: GET /social hidrata (não votado); POST /vote confirma.
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      const body = url.endsWith('/social')
        ? { viewerVoted: false, viewerSaved: false, isOwner: false }
        : { voteCount: 6, viewerVoted: true }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderControls({ initialVoteCount: 5 })

    // Espera a hidratação (botão "Votar" interativo disponível).
    const votar = await screen.findByRole('button', { name: M.votar })
    await user.click(votar)

    // Votou de verdade pelo endpoint real (não "Entrar para votar").
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/recipes/r-1/vote')).toBe(true)
    const votado = await screen.findByRole('button', { name: M.votado })
    expect(votado).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('6 votos')).toBeInTheDocument()
  })
})

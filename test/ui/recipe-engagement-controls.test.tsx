import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom dos controles de Engajamento da Comunidade (#62/#362) — seam de
 * frontend (sem browser/Postgres). `fetch` é mockado no SHAPE REAL das rotas (save/unsave ⇒
 * `{viewerSaved}`; GET /social ⇒ `{viewerSaved, isOwner}`). `next/link` é mockado; o locale é
 * real (LocaleProvider). O componente NÃO usa `useRouter`: o corpo do POST é autoritativo e nada
 * na page deriva do save, então não há `router.refresh()` a mockar/assertar. Cobre o botão Salvar
 * no detalhe, save-anônimo, dono-salva-a-própria, hidratação no caminho público, e a robustez
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

// `useSession` (#230 follow-up): o componente resolve o estado do viewer no cliente quando o
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
  initialViewerSaved?: boolean
  locale?: Locale
}

function renderControls(opts: Props = {}) {
  const { initialViewerSaved, locale = 'pt-BR' } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEngagementControls recipeId="r-1" initialViewerSaved={initialViewerSaved} />
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

describe('RecipeEngagementControls (#62/#362)', () => {
  it('T1 — salvar (200, server-resolved): botão alterna para "Salvo"', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { viewerSaved: true } })
    renderControls({ initialViewerSaved: false })

    await user.click(screen.getByRole('button', { name: M.salvar }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/save')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
    const salvo = await screen.findByRole('button', { name: M.salvo })
    expect(salvo).toHaveAttribute('aria-pressed', 'true')
  })

  it('T2 — dessalvar (200): botão volta a "Salvar"', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { viewerSaved: false } })
    renderControls({ initialViewerSaved: true })

    await user.click(screen.getByRole('button', { name: M.salvo }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/unsave')
    const salvar = await screen.findByRole('button', { name: M.salvar })
    expect(salvar).toHaveAttribute('aria-pressed', 'false')
  })

  it('T3 — DONO/server-resolved: salvar a própria FUNCIONAL (sem fetch de hidratação)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: { viewerSaved: true } })
    // `initialViewerSaved` presente ⇒ serverResolved ⇒ interativo direto, sem GET /social.
    renderControls({ initialViewerSaved: false })

    await user.click(screen.getByRole('button', { name: M.salvar }))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/save')
    expect(await screen.findByRole('button', { name: M.salvo })).toBeInTheDocument()
    // Nunca bateu no /social (estado veio por prop).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/social'))).toBe(false)
  })

  it('T4 — ANÔNIMO: link /sign-in para salvar, sem botão, sem fetch', async () => {
    const user = userEvent.setup()
    setSession('anon')
    const fetchMock = mockFetch({ status: 200, body: {} })
    // Sem initialViewerSaved (caminho público) + sessão anônima ⇒ convite a entrar.
    renderControls({})

    const salvarLink = screen.getByRole('link', { name: M.convidaEntrarSalvar })
    expect(salvarLink).toHaveAttribute('href', '/sign-in')

    expect(screen.queryByRole('button', { name: M.salvar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.salvo })).toBeNull()

    // Clicar no link NÃO toca a API (anônimo).
    await user.click(salvarLink)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T5 — erro no salvar: OTIMISMO → REVERSÃO + alerta neutro, sem âmbar/accent', async () => {
    const user = userEvent.setup()
    const d = deferred()
    mockFetch(d.factory)
    const { container } = renderControls({ initialViewerSaved: false })

    await user.click(screen.getByRole('button', { name: M.salvar }))

    // Estado OTIMISTA enquanto pendente: vira "Salvo", aria-pressed=true, busy.
    const otimista = screen.getByRole('button', { name: M.salvo })
    expect(otimista).toHaveAttribute('aria-pressed', 'true')
    expect(otimista).toHaveAttribute('aria-busy', 'true')

    // Servidor recusa (404 fora do pool = defesa em profundidade) ⇒ REVERSÃO.
    d.release({ status: 404, body: { error: 'not_found' } })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.erroSalvar)
    const revertido = screen.getByRole('button', { name: M.salvar })
    expect(revertido).toHaveAttribute('aria-pressed', 'false')
    semCorReservada(container)
  })

  it('T6 — en-US: rótulos traduzidos', () => {
    renderControls({ locale: 'en-US', initialViewerSaved: false })
    expect(screen.getByRole('button', { name: enUS.comunidade.salvar })).toBeInTheDocument()
  })

  // ── Caminho PÚBLICO/cacheável (#230, ADR-0020): server NÃO entrega estado do viewer (lê anônimo).
  //    O componente o resolve NO CLIENTE via GET /api/recipes/[id]/social quando logado. Este era o
  //    bug: logado via sempre "Entrar para salvar". ─────────────────────────────────────────────

  it('T7 — LOGADO no caminho público: GET /social hidrata o save real (sem convite)', async () => {
    setSession('logged-in')
    // Sem initialViewerSaved ⇒ caminho público; o fetch resolve o estado do PRÓPRIO viewer.
    const fetchMock = mockFetch({
      status: 200,
      body: { viewerSaved: false, isOwner: false },
    })
    renderControls({})

    // Hidrata: salvar disponível e NÃO-pressionado.
    const salvar = await screen.findByRole('button', { name: M.salvar })
    expect(salvar).toHaveAttribute('aria-pressed', 'false')

    // Bateu no endpoint certo (estado do viewer), via GET (sem method).
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/social')

    // O BUG: NÃO mostra mais o convite "Entrar para..." pra quem está logado.
    expect(screen.queryByRole('link', { name: M.convidaEntrarSalvar })).toBeNull()
  })

  it('T8 — LOGADO DONO no caminho público (viewerSaved via /social): mostra "Salvo"', async () => {
    setSession('logged-in')
    mockFetch({ status: 200, body: { viewerSaved: true, isOwner: true } })
    renderControls({})

    // Save hidratado (dono pode salvar a própria).
    expect(await screen.findByRole('button', { name: M.salvo })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.convidaEntrarSalvar })).toBeNull()
  })

  it('T9 — sessão PENDENTE no caminho público: nem convite nem botão, sem fetch', () => {
    setSession('pending')
    const fetchMock = mockFetch({ status: 200, body: {} })
    renderControls({})

    // Nada de flash de "Entrar" nem de botões enquanto a sessão pende.
    expect(screen.queryByRole('link', { name: M.convidaEntrarSalvar })).toBeNull()
    expect(screen.queryByRole('button', { name: M.salvar })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T10 — GET /social FALHA (logado): degrada pra botão interativo (default), nunca convite', async () => {
    setSession('logged-in')
    mockFetch({ reject: true })
    renderControls({})

    // Degradação graciosa: botão interativo com default (não-salvo), nunca o convite "Entrar"
    // (o usuário está logado) nem crash. O server corrige no clique.
    const salvar = await screen.findByRole('button', { name: M.salvar })
    expect(salvar).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('link', { name: M.convidaEntrarSalvar })).toBeNull()
  })

  it('T11 — LOGADO via caminho público hidratado: clicar SALVA de fato (POST /save)', async () => {
    const user = userEvent.setup()
    setSession('logged-in')
    // Mock por URL: GET /social hidrata (não salvo); POST /save confirma.
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      const body = url.endsWith('/social')
        ? { viewerSaved: false, isOwner: false }
        : { viewerSaved: true }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderControls({})

    // Espera a hidratação (botão "Salvar" interativo disponível).
    const salvar = await screen.findByRole('button', { name: M.salvar })
    await user.click(salvar)

    // Salvou de verdade pelo endpoint real (não "Entrar para salvar").
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/recipes/r-1/save')).toBe(true)
    expect(await screen.findByRole('button', { name: M.salvo })).toBeInTheDocument()
  })
})

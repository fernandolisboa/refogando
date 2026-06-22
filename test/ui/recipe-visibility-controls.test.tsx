import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { RecipeView } from '@/domain/recipe-read'
import type { ResultKind, Visibility } from '@/domain/recipe'

/**
 * Teste de COMPONENTE jsdom dos controles de Visibilidade (#59) — seam de frontend da #54
 * (sem browser/Postgres). `fetch` é mockado no SHAPE REAL das rotas `POST /publish` /
 * `POST /unpublish` (devolvem RecipeView CRU, `Response.json(view)`). `next/navigation`
 * (`useRouter().refresh`) e os hooks de locale são reais (LocaleProvider). Asserções
 * load-bearing: badge/estado, endpoint chamado, estado playful, loading/erro, en-US.
 *
 * ADR-0004: ÂMBAR é EXCLUSIVO do Aviso de restrição — provamos a ausência de âmbar pela
 * AUSÊNCIA das classes `aviso-*` em TODO o componente (não por `role="note"`, que também é
 * o token NEUTRO do stale-banner — logo não prova nada sobre âmbar).
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { RecipeVisibilityControls } from '@/components/recipe/recipe-visibility-controls'

const M = ptBR.visibilidade

/** Fixture mínima da view de gestão devolvida por publish/unpublish (shape REAL, do dono). */
function ownerView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Feijão tropeiro',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: null, passos: null, notas: null },
    facets: { cozinha: null, categoria: null, tags: [] },
    porcoes: null,
    dificuldade: null,
    ingredients: [],
    translations: [],
    autoTranslationSignal: false,
    canManage: true,
    visibility: 'private',
    resultKind: 'success',
    ...over,
  }
}

type FetchResult = { status: number; body: unknown } | { reject: true }

/** Mocka `fetch` por URL; opcionalmente pendura a resposta via factory (loading sem corrida). */
function mockFetch(result: FetchResult | (() => Promise<FetchResult>)) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (!url.includes('/api/recipes/')) throw new Error(`fetch não mockado: ${url}`)
    const r = typeof result === 'function' ? await result() : result
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
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

function renderControls(
  opts: { visibility?: Visibility; resultKind?: ResultKind; locale?: Locale } = {},
) {
  const { visibility = 'private', resultKind = 'success', locale = 'pt-BR' } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeVisibilityControls recipeId="r-1" initialVisibility={visibility} resultKind={resultKind} />
    </LocaleProvider>,
  )
}

/** Garante que NENHUM nó do componente carrega classe âmbar (`aviso-*`) — ADR-0004. */
function semAmbar(container: HTMLElement) {
  expect(container.querySelector('[class*="aviso"]')).toBeNull()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
})

describe('RecipeVisibilityControls (#59)', () => {
  it('T1 — privada → publicar: badge vira "Pública", chama /publish POST e router.refresh', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: ownerView({ visibility: 'public' }) })
    renderControls({ visibility: 'private' })

    expect(screen.getByText(M.privadaBadge)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.publicar }))

    // Endpoint correto + método POST.
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1/publish')
    expect((call[1] as RequestInit).method).toBe('POST')

    // Estado reflete: badge "Pública", botão agora "Despublicar", refresh chamado.
    expect(await screen.findByText(M.publicaBadge)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.despublicar })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('T2 — pública → despublicar: chama /unpublish, badge volta a "Privada"', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ status: 200, body: ownerView({ visibility: 'private' }) })
    renderControls({ visibility: 'public' })

    expect(screen.getByText(M.publicaBadge)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.despublicar }))

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/recipes/r-1/unpublish')
    expect(await screen.findByText(M.privadaBadge)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.publicar })).toBeInTheDocument()
  })

  it('T3 — playful: botão "Publicar" desabilitado, nota de bloqueio, SEM âmbar', () => {
    const { container } = renderControls({ visibility: 'private', resultKind: 'playful' })

    const botao = screen.getByRole('button', { name: M.publicar })
    expect(botao).toBeDisabled()
    expect(screen.getByText(M.playfulBloqueio)).toBeInTheDocument()
    // ADR-0004: nada de âmbar (a nota/o estado são neutros).
    semAmbar(container)
  })

  it('T4 — 422 defensivo (se um playful escapar ao disable): alerta neutro, badge inalterado', async () => {
    const user = userEvent.setup()
    // Estado coerente: success+private (botão habilitado), mas a rota responde 422.
    mockFetch({ status: 422, body: { error: 'playful_nao_publicavel' } })
    const { container } = renderControls({ visibility: 'private', resultKind: 'success' })

    await user.click(screen.getByRole('button', { name: M.publicar }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.erroPlayful)
    // Visibilidade NÃO mudou (segue privada) e o alerta é neutro (sem âmbar).
    expect(screen.getByText(M.privadaBadge)).toBeInTheDocument()
    semAmbar(container)
  })

  it('T5 — loading + erro genérico (500): durante a espera aria-busy/desabilitado; depois alerta', async () => {
    const user = userEvent.setup()
    const d = deferred()
    mockFetch(d.factory)
    renderControls({ visibility: 'private' })

    await user.click(screen.getByRole('button', { name: M.publicar }))

    // Loading PENDURADO: botão "Atualizando…", desabilitado, aria-busy.
    const loadingBtn = screen.getByRole('button', { name: M.atualizando })
    expect(loadingBtn).toBeDisabled()
    expect(loadingBtn).toHaveAttribute('aria-busy', 'true')

    d.release({ status: 500, body: { error: 'boom' } })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.erroGenerico)
    // Estado de Visibilidade inalterado, refresh NÃO chamado (não houve sucesso).
    expect(screen.getByText(M.privadaBadge)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('T6 — en-US: badge "Private", botão "Publish"', () => {
    renderControls({ visibility: 'private', locale: 'en-US' })
    expect(screen.getByText(enUS.visibilidade.privadaBadge)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.visibilidade.publicar })).toBeInTheDocument()
  })
})

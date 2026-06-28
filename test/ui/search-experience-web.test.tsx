import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

/**
 * Teste de COMPONENTE jsdom da DESCOBERTA na web (#164, ADR-0019) na Busca. Cobre o GATING no cliente:
 *  - acervo local RASO (abaixo do limiar) ⇒ dispara /api/discovery/web e renderiza a seção "Da web"
 *    com LINKS externos (target=_blank, rel external), marcados "da web · <fonte>";
 *  - acervo local SUFICIENTE ⇒ NÃO chama /api/discovery/web (nem mostra a seção);
 *  - os links da web vivem numa seção SEPARADA, fora do ranking interno (não viram RecipeResultItem).
 *
 * Espelha os mocks canônicos (next/link → <a>; useSession → estado mutável). O `fetch` é roteado por
 * URL: /api/search devolve o acervo local; /api/discovery/web devolve os links da web.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #169: a Busca usa useRouter().push para levar o usuário à receita importada após o 201. #236: usa
// .replace pra refletir a busca na URL (refino inline).
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
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

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { COZINHA_VOCAB_PT_BR } from '../helpers/cozinha-vocab'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const M = ptBR.busca

type WebLink = { title: string; url: string; sourceName: string }

function renderSearch() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={COZINHA_VOCAB_PT_BR}>
        <HomeSearchProvider>
          <HomeSearchBar />
          <SearchExperience />
        </HomeSearchProvider>
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

const WEB_LINKS: WebLink[] = [
  { title: 'Feijoada Completa', url: 'https://tudogostoso.com.br/feijoada', sourceName: 'TudoGostoso' },
  { title: 'Feijoada à Brasileira', url: 'https://panelinha.com.br/feijoada', sourceName: 'Panelinha' },
]

/**
 * Mocka `fetch` roteando por URL: /api/search → `search`; /api/discovery/web → `web`. Devolve o spy
 * para asserções de "foi/não foi chamado".
 */
function stubFetchRouting(
  search: SearchResponse,
  web: WebLink[],
  importResult: { status: number; body?: unknown } = { status: 201, body: { recipeId: 'imp-1', visibility: 'private' } },
) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/discovery/web')) {
      return { ok: true, json: async () => ({ results: web }) }
    }
    // #169: POST /api/recipes/import — devolve o status configurado (201 sucesso / 422 não importável).
    if (url.includes('/api/recipes/import')) {
      return {
        ok: importResult.status >= 200 && importResult.status < 300,
        status: importResult.status,
        json: async () => importResult.body ?? {},
      }
    }
    return { ok: true, json: async () => search }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

const emptyLocal: SearchResponse = { minhas: [], catalogo: [], comunidade: [] }

function localWith(n: number): SearchResponse {
  const comunidade = Array.from({ length: n }, (_, i) => ({
    recipeId: `r${i}`,
    displayedTitle: `Receita ${i}`,
    origin: 'ai_chat' as const,
    autoTranslationSignal: false,
    isOwn: false,
  }))
  return { minhas: [], catalogo: [], comunidade }
}

function discoveryCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/discovery/web'))
}

beforeEach(() => {
  sessionState = anon()
  push.mockClear()
})

/** Helper para casar o nome acessível do gatilho do resultado da web (título + atribuição). */
function webTrigger(title: string) {
  return screen.findByRole('button', { name: new RegExp(title) })
}


/**
 * Variante de `stubFetchRouting` com a resposta de `/api/discovery/web` CONTROLÁVEL via promise diferida.
 * Usada para inspecionar o estado em-voo do CTA manual (#275): loading/disabled/aria-busy e a ausência
 * do CTA enquanto a web automática (#164) ainda não resolveu.
 */
function stubFetchRoutingDeferred(search: SearchResponse) {
  let resolveWeb!: (links: WebLink[]) => void
  const webPromise = new Promise<WebLink[]>((r) => {
    resolveWeb = r
  })
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/discovery/web')) {
      const links = await webPromise
      return { ok: true, json: async () => ({ results: links }) }
    }
    return { ok: true, json: async () => search }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock: fetchMock as unknown as ReturnType<typeof vi.fn>, resolveWeb }
}

/**
 * Variante de `stubFetchRoutingDeferred` que REPRODUZ o `AbortController` real: a resposta de
 * `/api/discovery/web` fica diferida, MAS se o `signal` da requisição abortar (uma nova busca cancela a
 * anterior via `webAbortRef.abort()`), o fetch REJEITA com `AbortError` — como o `fetch` do navegador.
 * Usada para o cenário de CORRIDA (#275): um clique no CTA superado por nova digitação não pode acabar
 * pintando o aviso "nada na web" obsoleto.
 */
function stubFetchRoutingWebAbortable(search: SearchResponse) {
  let resolveWeb!: (links: WebLink[]) => void
  let rejectWeb!: (err: unknown) => void
  const webPromise = new Promise<WebLink[]>((res, rej) => {
    resolveWeb = res
    rejectWeb = rej
  })
  const fetchMock = vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input)
    if (url.includes('/api/discovery/web')) {
      // Reproduz o fetch real: abortar o signal REJEITA a requisição com AbortError.
      init?.signal?.addEventListener('abort', () =>
        rejectWeb(new DOMException('Aborted', 'AbortError')),
      )
      const links = await webPromise
      return { ok: true, json: async () => ({ results: links }) }
    }
    return { ok: true, json: async () => search }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock: fetchMock as unknown as ReturnType<typeof vi.fn>, resolveWeb }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — descoberta na web (#164)', () => {
  it('W1 — acervo RASO (1 resultado): mostra a seção "Da web" com cartões marcados (gatilhos de import)', async () => {
    const fetchMock = stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    // A seção "Da web" aparece (heading nível 2 separado).
    const heading = await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(heading).toBeInTheDocument()

    // #169: cada resultado da web é agora um GATILHO (button) que abre o modal de import — NÃO um
    // link externo cru. O nome acessível combina título + atribuição ("da web · <fonte>").
    const trigger = await webTrigger(WEB_LINKS[0].title)
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // #5 (protótipo final): a linha compacta credita a FONTE à direita + um chip "web".
    expect(screen.getByText(WEB_LINKS[0].sourceName)).toBeInTheDocument()
    expect(screen.getAllByText('web').length).toBeGreaterThan(0)

    // A descoberta na web FOI chamada (com o termo).
    expect(discoveryCalls(fetchMock).length).toBeGreaterThan(0)
    expect(String(discoveryCalls(fetchMock)[0][0])).toContain('q=feijoada')
  })

  it('W2 — acervo SUFICIENTE: NÃO chama /api/discovery/web nem mostra a seção', async () => {
    const fetchMock = stubFetchRouting(localWith(3), WEB_LINKS) // 3 = no limiar, NÃO é raso
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    // Os resultados locais aparecem (Comunidade).
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // Damos tempo a qualquer efeito assíncrono — e a web NÃO é tocada.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/search')),
      ).toBe(true)
    })
    expect(discoveryCalls(fetchMock).length).toBe(0)
    expect(screen.queryByRole('heading', { name: M.secaoDaWeb })).not.toBeInTheDocument()
  })

  it('W3 — acervo raso mas web VAZIA: não renderiza a seção "Da web"', async () => {
    stubFetchRouting(emptyLocal, []) // raso, mas a web devolveu nada (desligada/sem allowlist)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'inexistente')

    // O vazio local aparece; a seção da web NÃO (sem links).
    await screen.findByText(M.semResultado)
    expect(screen.queryByRole('heading', { name: M.secaoDaWeb })).not.toBeInTheDocument()
  })

  it('W4 — resultados da web NÃO entram no ranking interno (seção própria, gatilho, não RecipeResultItem)', async () => {
    stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    const trigger = await webTrigger(WEB_LINKS[0].title)
    // O gatilho vive sob a seção "Da web", NÃO sob Catálogo/Comunidade/Minhas.
    const section = trigger.closest('section')!
    const sectionHeading = section.querySelector('h2')
    expect(sectionHeading?.textContent).toBe(M.secaoDaWeb)
    // E é um BOTÃO (abre modal), nunca uma rota interna /recipes/<id>.
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).not.toHaveAttribute('href')
  })
})

// ── #169 (ADR-0019): modal de importação ligado ao backend de import ────────────
describe('SearchExperience — modal de importação (#169)', () => {
  it('I1 — LOGADO: clicar num resultado da web abre o modal de confirmação (com "Ver no site")', async () => {
    sessionState = authed()
    stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    const trigger = await webTrigger(WEB_LINKS[0].title)
    await user.click(trigger)

    // Modal aberto: role=dialog com o título de importação.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(M.importarTitulo)).toBeInTheDocument()
    // Caminho "Ver no site": link externo pro site de origem (exibir ≠ importar).
    const verNoSite = screen.getByRole('link', { name: M.importarVerNoSite })
    expect(verNoSite).toHaveAttribute('href', WEB_LINKS[0].url)
    expect(verNoSite).toHaveAttribute('target', '_blank')
    expect(verNoSite.getAttribute('rel')).toContain('external')
  })

  it('I2 — LOGADO: confirmar chama POST /api/recipes/import com a URL e navega à receita importada', async () => {
    sessionState = authed()
    const fetchMock = stubFetchRouting(localWith(1), WEB_LINKS, {
      status: 201,
      body: { recipeId: 'imp-99', visibility: 'private' },
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: M.importarConfirmar }))

    // POST /api/recipes/import com a URL escolhida.
    await waitFor(() => {
      const importCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/recipes/import'))
      expect(importCall).toBeTruthy()
      const init = importCall![1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ url: WEB_LINKS[0].url })
    })
    // Sucesso (201) ⇒ navega à receita importada. #231 (ADR-0020): canônico locale-no-caminho
    // `/{locale}/recipes/<uuid>` (que 308a pro slug); o provider monta sob 'pt-BR'. Nunca link nu.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/pt-BR/recipes/imp-99'))
  })

  it('I3 — LOGADO: 422 (site sem JSON-LD) mostra erro "não importável" e NÃO navega', async () => {
    sessionState = authed()
    stubFetchRouting(localWith(1), WEB_LINKS, { status: 422, body: { error: 'no_jsonld' } })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: M.importarConfirmar }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.importarErroNaoImportavel)
    expect(push).not.toHaveBeenCalled()
  })

  it('I4 — VISITANTE: clicar num resultado da web abre o convite de entrar (não importa)', async () => {
    sessionState = anon()
    const fetchMock = stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))

    const dialog = await screen.findByRole('dialog')
    // Convite de entrar (gerar/importar exige conta) — sem botão de confirmar import. #5 (Direção C): o
    // acervo raso vazio ⇒ o estado VAZIO renderiza o convite "Gerar com IA" (que TAMBÉM tem um link
    // "Entrar"). Por isso escopamos a asserção do sign-in ao DIÁLOGO (o real navegador inerte o fundo via
    // aria-hidden; a colisão é artefato do jsdom). `importarConviteTitulo` é exclusivo do diálogo.
    expect(within(dialog).getByText(M.importarConviteTitulo)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByRole('button', { name: M.importarConfirmar })).not.toBeInTheDocument()
    // Nunca chamou o endpoint de import.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/import'))).toBe(false)
  })

  it('I5 — A11y: ESC fecha o modal', async () => {
    sessionState = authed()
    stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

// ── #275 (ADR-0019): 2º gatilho EXPLÍCITO "buscar na web" no FIM dos resultados ──────────
// Coexiste com o gatilho automático #164 (acervo raso): o CTA cobre o caso COMPLEMENTAR (acervo
// SUFICIENTE) — "rolei até o fim e nada serviu". Reusa a MESMA /api/discovery/web (allowlist-restrita,
// degrade-200). O CTA dispara a web SÓ por AÇÃO do usuário (preserva "Busca nunca cria").
describe('SearchExperience — CTA manual buscar na web (#275)', () => {
  it('C1 — acervo SUFICIENTE + termo: CTA aparece, clique chama a web e renderiza os links (CTA some)', async () => {
    const fetchMock = stubFetchRouting(localWith(3), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    // Resultados locais concluídos (acervo suficiente).
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })
    // O gatilho automático NÃO disparou (acervo >= limiar).
    expect(discoveryCalls(fetchMock).length).toBe(0)

    // O CTA manual aparece ao fim dos resultados.
    const cta = await screen.findByRole('button', { name: M.webManualCta })
    expect(cta).toBeInTheDocument()

    await user.click(cta)

    // A seção "Da web" renderiza os links e o CTA some.
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    await webTrigger(WEB_LINKS[0].title)
    const calls = discoveryCalls(fetchMock)
    expect(calls.length).toBeGreaterThan(0)
    expect(String(calls[0][0])).toContain('q=feijoada')
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
  })

  it('C2 — auto-trigger (acervo RASO) acende a web SEM CTA (não-regressão #164, sem flash)', async () => {
    stubFetchRouting(localWith(1), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    // A web automática acendeu...
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    // ...e o CTA manual NUNCA aparece no caminho raso (gate por inventário ⇒ timing-independente).
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
  })

  it('C2b — sem CTA enquanto a web AUTOMÁTICA está em voo (acervo raso, promise diferida)', async () => {
    const { resolveWeb } = stubFetchRoutingDeferred(localWith(1))
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    // Local raso concluído (1 resultado), web AUTOMÁTICA ainda em voo: o CTA manual #275 NÃO pode piscar.
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()

    // Resolve a web automática → a seção "Da web" renderiza; o CTA segue ausente.
    resolveWeb(WEB_LINKS)
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
  })

  it('C3 — clique que volta {results:[]} degrada gracioso (aviso neutro na live region, sem erro vermelho)', async () => {
    const fetchMock = stubFetchRouting(localWith(3), [])
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    await user.click(await screen.findByRole('button', { name: M.webManualCta }))

    // Aviso neutro discreto, NUNCA estado de erro.
    const aviso = await screen.findByText(M.webManualNada)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
    expect(discoveryCalls(fetchMock).length).toBeGreaterThan(0)
    // O aviso vive DENTRO da live region (anunciado ao leitor de tela).
    expect(aviso.closest('[aria-live="polite"]')).not.toBeNull()
  })

  it('C4 — facet-only (sem termo) NÃO mostra nem dispara o CTA', async () => {
    const fetchMock = stubFetchRouting(localWith(3), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    // Marca uma cozinha (busca SÓ por faceta, sem termo). #5: a trilha é permanente (sem disclosure
    // `<details>`); o jsdom não esconde por CSS, então o chip já está no DOM — clique direto.
    await user.click(screen.getByLabelText('Brasileira'))

    // Sync POSITIVO: espera os resultados concluírem ANTES das asserções negativas.
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
    expect(discoveryCalls(fetchMock).length).toBe(0)
  })

  it('C5 — RESET na 2ª busca: trocar o termo volta o CTA a idle; limpar tudo o remove', async () => {
    stubFetchRouting(localWith(3), [])
    const user = userEvent.setup()
    renderSearch()

    const box = screen.getByRole('searchbox')
    await user.type(box, 'feijoada')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // Clica o CTA → web volta vazia → aviso "nada" (estado done).
    await user.click(await screen.findByRole('button', { name: M.webManualCta }))
    await screen.findByText(M.webManualNada)

    // Muda o termo → nova busca reseta webManualState=idle ⇒ o CTA reaparece.
    await user.type(box, 'x')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: M.webManualCta })).toBeInTheDocument(),
    )

    // Limpar TODO o termo volta ao repouso (sem prender o CTA).
    await user.clear(box)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument(),
    )
  })

  it('C6 — loading: botão desabilitado + "buscando…" + aria-busy; duplo-clique não re-dispara (guard)', async () => {
    const { fetchMock, resolveWeb } = stubFetchRoutingDeferred(localWith(3))
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    await user.click(await screen.findByRole('button', { name: M.webManualCta }))

    // Em voo: o botão mostra "buscando…", está disabled e aria-busy.
    const buscando = await screen.findByRole('button', { name: M.webManualBuscando })
    expect(buscando).toBeDisabled()
    expect(buscando).toHaveAttribute('aria-busy', 'true')

    // Clicar de novo enquanto carrega NÃO re-dispara (guard de reentrância).
    await user.click(buscando)
    expect(discoveryCalls(fetchMock).length).toBe(1)

    // Resolve → os links renderizam.
    resolveWeb(WEB_LINKS)
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
  })

  it('C7 — clique SUPERADO por nova digitação NÃO pinta o aviso "nada na web" obsoleto (corrida)', async () => {
    // Acervo suficiente ⇒ o auto-gate #164 NÃO dispara; o único fetch de web é o do clique manual,
    // cuja resposta fica diferida e ABORTA quando a nova busca cancela a anterior.
    const { resolveWeb } = stubFetchRoutingWebAbortable(localWith(3))
    const user = userEvent.setup()
    renderSearch()

    const box = screen.getByRole('searchbox')
    await user.type(box, 'feijoada')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // Clica o CTA → busca manual EM VOO (promise diferida; o botão mostra "buscando…").
    await user.click(await screen.findByRole('button', { name: M.webManualCta }))
    await screen.findByRole('button', { name: M.webManualBuscando })

    // Nova digitação dispara nova busca → ABORTA o fetch manual em voo (corrida superada). O reset de
    // `doSearch` devolve o CTA a `idle`; o `done` obsoleto da corrida abortada NÃO pode aparecer.
    await user.type(box, 'x')

    // A nova busca conclui e o CTA volta (idle); o aviso obsoleto "nada na web" NUNCA aparece.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: M.webManualCta })).toBeInTheDocument(),
    )
    expect(screen.queryByText(M.webManualNada)).not.toBeInTheDocument()

    // Resolver TARDE a web da corrida superada (já abortada) segue sem pintar o aviso obsoleto.
    resolveWeb(WEB_LINKS)
    await waitFor(() => {
      expect(screen.queryByText(M.webManualNada)).not.toBeInTheDocument()
    })
  })
})

// ── #5 (protótipo final): estado VAZIO com DOIS cartões (Gerar com IA + Buscar na web) ───────────
// O mock final mostra o cartão MANUAL "Buscar na web" no estado VAZIO (não a "Da web" automática). O
// auto-gate #164 agora só acende no acervo RASO-mas-NÃO-vazio (1..2, ou sugestões-only); no TRULY-empty
// a web é OFERECIDA (botão "Buscar"), preservando fetch-só-por-ação. Reusa a máquina do #275.
function withSugestoes(n: number): SearchResponse {
  const sugestoes = Array.from({ length: n }, (_, i) => ({
    recipeId: `s${i}`,
    displayedTitle: `Sugestão ${i}`,
    origin: 'ai_chat' as const,
    autoTranslationSignal: false,
    isOwn: false,
  }))
  return { minhas: [], catalogo: [], comunidade: [], sugestoes }
}

describe('SearchExperience — estado VAZIO: cartões Gerar + Buscar na web (#5)', () => {
  it('E1 — VAZIO + termo (visitante): cartão "Buscar na web" + convite Gerar; SEM "Da web" automática', async () => {
    sessionState = anon()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'ramen vegano picante')

    // Painel vazio honesto + o cartão MANUAL "Buscar na web" (botão "Buscar").
    await screen.findByText(M.semResultado)
    expect(screen.getByText(M.vazioWebTitulo)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.buscar })).toBeInTheDocument()
    // A web NÃO auto-disparou no caminho TRULY-empty (o mock mostra o cartão, não "Da web").
    expect(screen.queryByRole('heading', { name: M.secaoDaWeb })).not.toBeInTheDocument()
    expect(discoveryCalls(fetchMock).length).toBe(0)
  })

  it('E2 — VAZIO + termo (logado): cartão Gerar (link /create?q) + cartão "Buscar na web"; sem auto-web', async () => {
    sessionState = authed()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'ramen vegano picante')

    // Os DOIS cartões do mock: Gerar (link pré-preenchido) + Buscar na web (botão).
    const gerar = await screen.findByRole('link', { name: M.gerarComIa })
    expect(gerar).toHaveAttribute('href', '/create?q=ramen%20vegano%20picante')
    expect(screen.getByRole('button', { name: M.buscar })).toBeInTheDocument()
    expect(discoveryCalls(fetchMock).length).toBe(0)
  })

  it('E3 — VAZIO: clicar "Buscar na web" dispara a descoberta e renderiza "Da web" (o cartão some)', async () => {
    sessionState = authed()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'ramen vegano picante')
    const buscar = await screen.findByRole('button', { name: M.buscar })
    await user.click(buscar)

    // A web foi chamada por AÇÃO; a seção "Da web" renderiza os links; o botão do cartão some (webLinks>0).
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    await webTrigger(WEB_LINKS[0].title)
    expect(discoveryCalls(fetchMock).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: M.buscar })).not.toBeInTheDocument()
  })

  it('E4 — VAZIO por FACETA (sem termo): NÃO mostra o cartão "Buscar na web" (botão seria morto sem q)', async () => {
    sessionState = authed()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    // Busca SÓ por faceta (sem termo) que volta vazia → painel vazio, mas sem o cartão de web.
    await user.click(screen.getByLabelText('Brasileira'))
    await screen.findByText(M.semResultado)
    expect(screen.queryByRole('button', { name: M.buscar })).not.toBeInTheDocument()
    // Gerar segue disponível (sem ?q espúrio).
    expect(await screen.findByRole('link', { name: M.gerarComIa })).toHaveAttribute('href', '/create')
    expect(discoveryCalls(fetchMock).length).toBe(0)
  })

  it('E5 — REGRESSÃO: sugestões-only (0 diretos, mas há "Talvez você queira") AINDA auto-dispara a web', async () => {
    // localCount 0 mas hasResults via sugestões ⇒ NÃO é isEmpty ⇒ a web AUTO deve acender (o gate é
    // `localCount < 3 && !isEmpty`; o bug `0 < localCount` deixaria este caso sem web nenhuma).
    const fetchMock = stubFetchRouting(withSugestoes(2), WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'curry')

    // A seção de sugestões aparece E a "Da web" automática também (sem o painel vazio).
    await screen.findByRole('heading', { name: M.talvezQueira, level: 2 })
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(screen.queryByText(M.semResultado)).not.toBeInTheDocument()
    expect(discoveryCalls(fetchMock).length).toBeGreaterThan(0)
  })

  it('E6 — GATE: localCount 2 auto-dispara a web; localCount 0 (vazio) NÃO', async () => {
    // 2 locais (raso-não-vazio) ⇒ auto.
    const fetchMock2 = stubFetchRouting(localWith(2), WEB_LINKS)
    const user = userEvent.setup()
    const { unmount } = renderSearch()
    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(discoveryCalls(fetchMock2).length).toBeGreaterThan(0)
    unmount()
    vi.unstubAllGlobals()

    // 0 locais (vazio) ⇒ sem auto (cartão manual no lugar).
    const fetchMock0 = stubFetchRouting(emptyLocal, WEB_LINKS)
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'inexistente')
    await screen.findByText(M.semResultado)
    expect(discoveryCalls(fetchMock0).length).toBe(0)
  })
})

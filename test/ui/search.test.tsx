import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado.
// Mockamos pra um <a> simples — aqui o que importa é o href de detalhe e o comportamento
// da Busca, não a navegação do Next.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #169: a Busca usa useRouter().push (navega à receita após importar). #236: usa .replace pra
// REFLETIR o estado de busca na URL (refino inline). Mock p/ o jsdom (sem AppRouter montado o hook
// lança "invariant expected app router to be mounted").
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}))

// #116: a Busca agora lê useSession só para escolher a DICA INICIAL (anônimo vs logado). Sem
// mock, o hook tentaria buscar /api/auth/get-session (quebra no jsdom). Estado MUTÁVEL por
// teste: anônimo por padrão; o teste de cópia-logada troca para `authed()`.
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

import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { COZINHA_VOCAB_PT_BR } from '../helpers/cozinha-vocab'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

/**
 * Teste de COMPONENTE jsdom da Busca (#56) — seam de frontend da #54 (sem browser/
 * Postgres). Satisfaz a AC "Teste E2E" (buscar termo → seções+selos; vazio → neutro)
 * pela seam jsdom canônica deste repo: não há Playwright nas deps; o ambiente bloqueia
 * pacotes recém-publicados; a seam jsdom é o canal de teste de UI do projeto.
 *
 * `fetch` é mockado no shape REAL de `SearchResponse`. Como o fetch é debounced (300ms)
 * + async, usamos `findBy*` (assíncrono). O `setup.ts` já estende o expect com jest-dom.
 */

const M = ptBR.busca

function renderSearch() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={COZINHA_VOCAB_PT_BR}>
        {/* #5: o searchbox MUDOU-SE pro header (HomeSearchBar). Montamos a barra + o cérebro sob o
            MESMO HomeSearchProvider pra `getByRole('searchbox')` casar e o termo dirigir a busca. */}
        <HomeSearchProvider>
          <HomeSearchBar />
          <SearchExperience />
        </HomeSearchProvider>
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

/** Mocka `fetch` resolvendo uma resposta OK com o corpo dado. Devolve o spy. */
function stubFetchOk(body: SearchResponse) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

/** Última URL de BUSCA (`/api/search`) passada ao fetch, como string. Ignora a descoberta na web
 * (#164: `/api/discovery/web`) E a busca de Cozinheiros (#279: `/api/search/cooks`, que é um SUPERSET
 * textual de `/api/search` — precisa excluir explicitamente), que disparam em paralelo; estes testes
 * só asseguram a URL da Busca local de receitas. */
function lastFetchUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const searchCalls = fetchMock.mock.calls.filter((c) => {
    const u = String(c[0])
    return u.includes('/api/search') && !u.includes('/api/search/cooks')
  })
  return String(searchCalls.at(-1)?.[0])
}

beforeEach(() => {
  sessionState = anon()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience (#56)', () => {
  it('T1 — buscar termo → seções + selos + links + ordem', async () => {
    const fetchMock = stubFetchOk({
      minhas: [],
      catalogo: [
        {
          recipeId: 'r1',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
          isOwn: false,
          // #231: com slug, o card linka o canônico /{locale}/recipes/<slug>.
          slug: 'feijoada',
        },
      ],
      comunidade: [
        {
          recipeId: 'r2',
          displayedTitle: 'Strogonoff',
          origin: 'ai_chat',
          autoTranslationSignal: false,
          isOwn: false,
        },
      ],
    })

    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')

    // Chamou /api/search com q e locale.
    const catalogoHeading = await screen.findByRole('heading', {
      name: M.secaoCatalogo,
      level: 2,
    })
    const url = lastFetchUrl(fetchMock)
    expect(url).toContain('/api/search')
    expect(url).toContain('q=feijao')
    expect(url).toContain('locale=pt-BR')

    // Seções presentes.
    const comunidadeHeading = screen.getByRole('heading', {
      name: M.secaoComunidade,
      level: 2,
    })
    expect(catalogoHeading).toBeInTheDocument()
    expect(comunidadeHeading).toBeInTheDocument()

    // Ordem: Catálogo antes de Comunidade no DOM.
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings[0]).toBe(catalogoHeading)
    expect(headings[1]).toBe(comunidadeHeading)

    // Item de catalog: kicker "Do catálogo" PRESENTE, em erva (text-accent-strong). A lista
    // usa kicker de TEXTO (protótipo RefoStage), não a pílula — a erva segue exclusiva do catálogo.
    const feijoadaItem = screen.getByText('Feijoada').closest('li')!
    const catalogBadge = within(feijoadaItem).getByText(M.seloCatalogo)
    expect(catalogBadge).toBeInTheDocument()
    expect(catalogBadge).toHaveClass('text-accent-strong')

    // Item de comunidade: selo "Da comunidade" PRESENTE (assertion positiva); SEM accent.
    const strogonoffItem = screen.getByText('Strogonoff').closest('li')!
    const communityBadge = within(strogonoffItem).getByText(M.seloComunidade)
    expect(communityBadge).toBeInTheDocument()
    expect(communityBadge).not.toHaveClass('bg-accent-surface')

    // Links pro detalhe canônico (#231, ADR-0020): com slug ⇒ `/{locale}/recipes/<slug>`; sem slug ⇒
    // fallback `/{locale}/recipes/<uuid>` (que 308a). Locale pt-BR no provider. Nunca o link nu.
    expect(within(feijoadaItem).getByRole('link')).toHaveAttribute('href', '/pt-BR/recipes/feijoada')
    expect(within(strogonoffItem).getByRole('link')).toHaveAttribute(
      'href',
      '/pt-BR/recipes/r2',
    )
  })

  it('T2 — busca sem resultado → estado neutro, sem erro', async () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'zzzznaoexiste')

    await screen.findByText(M.semResultado)
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: M.secaoCatalogo, level: 2 }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: M.secaoComunidade, level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('T3 — estado inicial neutro NÃO chama a API', async () => {
    const fetchMock = stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    await screen.findByText(M.dicaInicial)
    // ESPERA a janela do debounce (300ms) ELAPSAR antes do assert negativo. Sem isso o
    // teste é VÁCUO: o render idle resolve síncrono, mas o timer de doSearch do effect de
    // mount ainda não disparou — então o assert passaria mesmo SEM o early-return `if
    // (!hasCriteria)`. Com o wait, T3 falha se o guarda for removido (mutation-verified).
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T3b (#116) — LOGADO: a dica inicial reflete "suas receitas + comunidade"', async () => {
    sessionState = authed()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    // Estado inicial neutro mostra a dica AUTENTICADA (key-path idêntica entre locales),
    // não a de comunidade.
    await screen.findByText(M.dicaInicialLogado)
    expect(screen.queryByText(M.dicaInicial)).not.toBeInTheDocument()
  })

  it('T4 — faceta aplicada na query (faceta-only, sem q espúrio)', async () => {
    const fetchMock = stubFetchOk({
      minhas: [],
      catalogo: [
        {
          recipeId: 'r3',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
          isOwn: false,
        },
      ],
      comunidade: [],
    })
    const user = userEvent.setup()
    renderSearch()

    // Marca o checkbox de Cozinha "Brasileira".
    await user.click(screen.getByLabelText('Brasileira'))

    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    const url = new URL(lastFetchUrl(fetchMock))
    // Literal de enum exato (case-sensitive — parseFacetParams valida assim).
    expect(url.searchParams.get('cozinha')).toBe('brasileira')
    // Faceta-only: nenhum q espúrio.
    expect(url.searchParams.get('q')).toBeNull()
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    // Caso MISTO (catálogo cheio, comunidade vazia): a guarda de seção vazia do
    // SearchSection deve SUPRIMIR o heading de Comunidade (sem heading órfão). Sem essa
    // assertion negativa a guarda fica vácua (mutation-verified: removê-la deixa T4 falhar).
    expect(
      screen.queryByRole('heading', { name: M.secaoComunidade, level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('T5 — "Talvez você queira" (sugestoes)', async () => {
    stubFetchOk({
      minhas: [],
      catalogo: [],
      comunidade: [],
      sugestoes: [
        {
          recipeId: 'r9',
          displayedTitle: 'Risoto',
          origin: 'ai_structured',
          autoTranslationSignal: false,
          isOwn: false,
        },
      ],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'arroz cremoso')

    await screen.findByRole('heading', { name: M.talvezQueira, level: 2 })
    const risotoItem = screen.getByText('Risoto').closest('li')!
    // #231: sem slug ⇒ fallback canônico locale-no-caminho `/{locale}/recipes/<uuid>` (pt-BR).
    expect(within(risotoItem).getByRole('link')).toHaveAttribute('href', '/pt-BR/recipes/r9')
    // Sugestão de origem comunidade (ai_structured) → selo de Comunidade.
    expect(within(risotoItem).getByText(M.seloComunidade)).toBeInTheDocument()
    // NÃO é estado vazio.
    expect(screen.queryByText(M.semResultado)).not.toBeInTheDocument()
  })

  it('T6 — erro de rede → estado de erro + retry recupera', async () => {
    // Primeiro: fetch rejeita (erro de rede real, não AbortError).
    const failing = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', failing)

    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')

    await screen.findByText(ptBR.system.error)
    const retry = screen.getByRole('button', { name: ptBR.system.retry })
    expect(retry).toBeInTheDocument()

    // Re-arma o mock para sucesso e clica em "Tentar de novo".
    const fetchMock = stubFetchOk({
      minhas: [],
      catalogo: [
        {
          recipeId: 'r1',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
          isOwn: false,
        },
      ],
      comunidade: [],
    })
    await user.click(retry)

    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    expect(fetchMock).toHaveBeenCalled()
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
  })

  it('T7 (#116/own-label) — seção "Minhas" PRIMEIRO + selo "Sua receita" no item próprio', async () => {
    sessionState = authed()
    stubFetchOk({
      minhas: [
        { recipeId: 'rOwn', displayedTitle: 'Minha receita', origin: 'ai_chat', autoTranslationSignal: false, isOwn: true },
      ],
      catalogo: [
        { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
      ],
      comunidade: [
        { recipeId: 'r2', displayedTitle: 'Strogonoff', origin: 'ai_chat', autoTranslationSignal: false, isOwn: false },
      ],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'receita')

    // A seção "Minhas" existe e vem PRIMEIRO (antes de Catálogo e Comunidade no DOM).
    const minhasHeading = await screen.findByRole('heading', { name: M.secaoMinhas, level: 2 })
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings[0]).toBe(minhasHeading)
    expect(headings.map((h) => h.textContent)).toEqual([
      M.secaoMinhas,
      M.secaoCatalogo,
      M.secaoComunidade,
    ])

    // O item próprio mostra o selo "Sua receita" (NÃO "Da comunidade").
    const ownItem = screen.getByText('Minha receita').closest('li')!
    expect(within(ownItem).getByText(M.seloMinha)).toBeInTheDocument()
    expect(within(ownItem).queryByText(M.seloComunidade)).not.toBeInTheDocument()

    // O item de comunidade genuína mantém o selo "Da comunidade".
    const communityItem = screen.getByText('Strogonoff').closest('li')!
    expect(within(communityItem).getByText(M.seloComunidade)).toBeInTheDocument()
    expect(within(communityItem).queryByText(M.seloMinha)).not.toBeInTheDocument()
  })

  it('T8 (#116/own-label) — anônimo: SEM seção "Minhas" e SEM selo "Sua receita"', async () => {
    sessionState = anon()
    stubFetchOk({
      minhas: [],
      catalogo: [
        { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
      ],
      comunidade: [
        { recipeId: 'r2', displayedTitle: 'Strogonoff', origin: 'ai_chat', autoTranslationSignal: false, isOwn: false },
      ],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'receita')
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })

    // `minhas` vazia ⇒ a guarda de seção vazia do SearchSection omite o heading.
    expect(screen.queryByRole('heading', { name: M.secaoMinhas, level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByText(M.seloMinha)).not.toBeInTheDocument()
  })
})

const MC = ptBR.comunidade

/** Catálogo + Comunidade semeados (estado conhecido para os testes de ordenação). */
function seededResponse(): SearchResponse {
  return {
    minhas: [],
    catalogo: [
      { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
    ],
    comunidade: [
      { recipeId: 'r2', displayedTitle: 'Strogonoff', origin: 'ai_chat', autoTranslationSignal: false, isOwn: false },
    ],
  }
}

describe('SearchExperience — ordenação da Comunidade (#62)', () => {
  it('T-sort-A — toggle PRESENTE quando há critério; default Relevância (vive junto do form)', async () => {
    stubFetchOk(seededResponse())
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // O grupo de ordenação vive junto do form (não dentro da seção Comunidade).
    const group = screen.getByRole('radiogroup', { name: MC.ordenarPor })
    expect(group).toBeInTheDocument()
    const relBtn = within(group).getByRole('radio', { name: MC.toggleRelevancia })
    const popBtn = within(group).getByRole('radio', { name: MC.togglePopularidade })
    expect(relBtn).toHaveAttribute('aria-checked', 'true')
    expect(popBtn).toHaveAttribute('aria-checked', 'false')
  })

  it('T-sort-A2 — toggle AUSENTE sem critério (gateado por hasCriteria)', async () => {
    const fetchMock = stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    await screen.findByText(M.dicaInicial)
    // Espera a janela do debounce elapsar (mesma técnica do T3) antes do assert negativo.
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('radiogroup', { name: MC.ordenarPor })).not.toBeInTheDocument()
  })

  it('T-sort-B — clicar Popularidade dispara ?sort=popularidade (re-fetch)', async () => {
    const fetchMock = stubFetchOk(seededResponse())
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // Default Relevância: a URL NÃO carrega sort=.
    expect(lastFetchUrl(fetchMock)).not.toContain('sort=')
    const callsAntes = fetchMock.mock.calls.length

    await user.click(screen.getByRole('radio', { name: MC.togglePopularidade }))

    // Vence o debounce (300ms): só então a URL nova fica disponível.
    await vi.waitFor(() => {
      expect(lastFetchUrl(fetchMock)).toContain('sort=popularidade')
    })
    // Houve re-fetch (não foi a URL da busca anterior).
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAntes)
  })

  it('T-sort-D — toggle PERSISTE com Comunidade vazia (vive FORA do SearchSection)', async () => {
    // Decisão de design: o SortToggle vive JUNTO do form (gateado por hasCriteria), NÃO
    // dentro do SearchSection da Comunidade — que se OMITE quando a lista volta vazia. Se o
    // toggle morasse lá dentro, ele DESAPARECERIA ao Popularidade trazer Comunidade vazia,
    // prendendo o usuário em Popularidade sem volta. Aqui: catálogo cheio + comunidade vazia
    // + sort=popularidade ⇒ o grupo ordenarPor SEGUE presente e Relevância re-busca sem sort=.
    // Mutation-verified: mover o toggle para dentro do SearchSection faria este teste falhar.
    const fetchMock = stubFetchOk({
      minhas: [],
      catalogo: [
        { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
      ],
      comunidade: [],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    // Comunidade vazia: o SearchSection dela se omite (sem heading órfão).
    expect(
      screen.queryByRole('heading', { name: M.secaoComunidade, level: 2 }),
    ).not.toBeInTheDocument()

    // Vai a Popularidade (re-busca) — a Comunidade segue vazia.
    await user.click(screen.getByRole('radio', { name: MC.togglePopularidade }))
    await vi.waitFor(() => {
      expect(lastFetchUrl(fetchMock)).toContain('sort=popularidade')
    })

    // O grupo de ordenação CONTINUA presente apesar da Comunidade vazia.
    const group = screen.getByRole('radiogroup', { name: MC.ordenarPor })
    expect(group).toBeInTheDocument()
    const callsAposPop = fetchMock.mock.calls.length

    // Clicar Relevância re-busca SEM sort= (o usuário não fica preso em Popularidade).
    await user.click(within(group).getByRole('radio', { name: MC.toggleRelevancia }))
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAposPop)
    })
    expect(lastFetchUrl(fetchMock)).not.toContain('sort=')
  })

  it('T-sort-C — voltar a Relevância remove sort= (re-fetch)', async () => {
    const fetchMock = stubFetchOk(seededResponse())
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    await user.click(screen.getByRole('radio', { name: MC.togglePopularidade }))
    await vi.waitFor(() => {
      expect(lastFetchUrl(fetchMock)).toContain('sort=popularidade')
    })
    const callsAposPop = fetchMock.mock.calls.length

    await user.click(screen.getByRole('radio', { name: MC.toggleRelevancia }))
    // Espera um re-fetch NOVO (a contagem aumenta) — sem isso confundiria com a URL inicial.
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAposPop)
    })
    expect(lastFetchUrl(fetchMock)).not.toContain('sort=')
  })
})

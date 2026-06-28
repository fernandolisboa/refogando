import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado. Mockamos
// para um <a> simples — o que importa aqui é o href do CTA (rota /create + termo), não a
// navegação do Next.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #169: a Busca usa useRouter().push (navega após importar). #236: usa .replace (reflete a busca na
// URL) — mock p/ o jsdom (sem AppRouter montado).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// A Busca lê useSession para escolher a dica inicial E, no #166, o ramo do CTA "Gerar com IA"
// (logado → link pro /create; visitante → convite de entrar). Estado MUTÁVEL por teste.
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

const M = ptBR.busca
const MI = ptBR.minhasCriacoes
const NAV = ptBR.nav

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

/** Mocka `fetch` resolvendo OK com o corpo dado. Devolve o spy. */
function stubFetchOk(body: SearchResponse) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  sessionState = anon()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// #5 (ADR-0019 emenda): o "Gerar com IA" foi REBAIXADO do CTA permanente (#166) para o ESTADO VAZIO — a
// saída de criação CONTEXTUAL quando a busca não acha nada. A lógica dos ramos (logado→link /create?q;
// visitante→convite; pendente→otimista) é PRESERVADA, só RELOCADA. Estes testes provam (a) os ramos no
// vazio e (b) o REBAIXAMENTO: gerar AUSENTE no repouso (idle) e AUSENTE quando há resultados. A entrada
// SEMPRE-disponível pra criar é o "Criar" do header global (fora deste componente).
describe('SearchExperience — "Gerar com IA" no estado vazio (#5, ADR-0019 emenda)', () => {
  it('C1 — logado: AUSENTE no repouso; faceta sem resultado → cartão leva ao /create (sem ?q espúrio)', async () => {
    sessionState = authed()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    // Repouso (logado): a dica aparece e o "Gerar com IA" NÃO (rebaixado — não é mais permanente).
    await screen.findByText(M.dicaInicialLogado)
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()

    // Busca SÓ por faceta (sem termo) que volta vazia → estado vazio → cartão "Gerar com IA".
    await user.click(screen.getByLabelText(ptBR.categoriaLabel.sobremesa))
    const cta = await screen.findByRole('link', { name: M.gerarComIa })
    // Sem termo: leva ao /create cru (sem ?q= vazio espúrio) — preserva a guarda do ramo bare-/create.
    expect(cta).toHaveAttribute('href', '/create')
  })

  it('C2 — logado: termo sem resultado → cartão leva ao /create?q=<termo>', async () => {
    sessionState = authed()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao tropeiro')
    const cta = await screen.findByRole('link', { name: M.gerarComIa })
    // O href carrega o termo buscado, URL-encoded (espaço → %20).
    expect(cta).toHaveAttribute('href', '/create?q=feijao%20tropeiro')
  })

  it('C2b — REBAIXAMENTO: COM resultados o "Gerar com IA" NÃO aparece (saiu do sempre-visível)', async () => {
    sessionState = authed()
    stubFetchOk({
      minhas: [],
      catalogo: [
        { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
      ],
      comunidade: [],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao tropeiro')
    // Há resultados (Catálogo) E o "Gerar com IA" NÃO está na tela (só no vazio).
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()
    expect(screen.queryByText(M.vazioGerarTitulo)).not.toBeInTheDocument()
  })

  it('C3 — visitante: termo sem resultado → CONVITE de entrar (não link pro /create)', async () => {
    sessionState = anon()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    // O rótulo "Gerar com IA" aparece como título da seção de convite (no vazio).
    await screen.findByText(M.gerarComIa)
    // NÃO há link pro /create para o visitante.
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()
    // Há um link de "Entrar" levando ao /sign-in (gerar exige conta) + a cópia do convite.
    expect(screen.getByRole('link', { name: NAV.signIn })).toHaveAttribute('href', '/sign-in')
    expect(screen.getByText(MI.convidaEntrarTexto)).toBeInTheDocument()
  })

  it('C4 — REBAIXAMENTO: visitante COM resultados NÃO vê o convite (saiu do sempre-visível)', async () => {
    sessionState = anon()
    stubFetchOk({
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
    // Com resultados, o convite "Gerar com IA" NÃO aparece (rebaixado pro vazio).
    expect(screen.queryByText(M.gerarComIa)).not.toBeInTheDocument()
    expect(screen.queryByText(MI.convidaEntrarTexto)).not.toBeInTheDocument()
  })

  it('C5 — sessão pendente: vazio → ramo logado (otimista, sem flash do convite)', async () => {
    sessionState = { ...anon(), isPending: true }
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    // No vazio, enquanto a sessão resolve, o cartão é o LINK (não o convite).
    const cta = await screen.findByRole('link', { name: M.gerarComIa })
    expect(cta).toHaveAttribute('href', '/create?q=feijao')
    expect(screen.queryByText(MI.convidaEntrarTexto)).not.toBeInTheDocument()
  })
})

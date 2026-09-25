import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

// Mesmos mocks de search-gerar-ia-cta.test.tsx: next/link → <a>, router e pathname para o jsdom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
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

function renderSearch(props: { webAvailable?: boolean } = {}) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={COZINHA_VOCAB_PT_BR}>
        <HomeSearchProvider>
          <HomeSearchBar />
          <SearchExperience {...props} />
        </HomeSearchProvider>
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

function stubFetchOk(body: SearchResponse) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

const VAZIO: SearchResponse = { minhas: [], catalogo: [], comunidade: [] }
const item = (id: string, titulo: string) => ({
  recipeId: id,
  displayedTitle: titulo,
  origin: 'catalog' as const,
  autoTranslationSignal: false,
  isOwn: false,
})
// Acervo SUFICIENTE (>= limiar 3): sem auto-web; o CTA manual #275 "Não achou? Buscar na web" aparece.
const SUFICIENTE: SearchResponse = {
  minhas: [],
  catalogo: [item('r1', 'Feijoada'), item('r2', 'Feijoada light'), item('r3', 'Feijoada vegana')],
  comunidade: [],
}
const COM_RESULTADO: SearchResponse = {
  minhas: [],
  catalogo: [
    { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false, isOwn: false },
  ],
  comunidade: [],
}

const atalho = (termo: string) => M.gerarAtalho.replace('{termo}', termo)

beforeEach(() => {
  sessionState = anon()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — sugerir gerar a partir da busca', () => {
  it('termo curto sem resultado ⇒ dica "digite mais letras" no lugar do cartão Gerar', async () => {
    sessionState = authed()
    stubFetchOk(VAZIO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'fr')
    await screen.findByText(M.digiteMaisLetras)
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()
  })

  it('termo só com dígitos sem resultado ⇒ cartão Gerar leva ao /create cru (sem "123" pré-preenchido)', async () => {
    sessionState = authed()
    stubFetchOk(VAZIO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), '123')
    const cta = await screen.findByRole('link', { name: M.gerarComIa })
    expect(cta).toHaveAttribute('href', '/create')
  })

  it('logado, termo que serve de pedido e COM resultados ⇒ atalho leva ao /create?q=', async () => {
    sessionState = authed()
    stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    const link = await screen.findByRole('link', { name: atalho('feijoada') })
    expect(link).toHaveAttribute('href', '/create?q=feijoada')
    expect(screen.getByText(M.gerarAtalhoLead)).toBeInTheDocument()
  })

  it('visitante COM resultados ⇒ atalho leva a entrar e, depois, ao próprio /create?q=', async () => {
    sessionState = anon()
    stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    const link = await screen.findByRole('link', { name: atalho('feijoada') })
    expect(link).toHaveAttribute('href', `/sign-in?returnTo=${encodeURIComponent('/create?q=feijoada')}`)
  })

  it('termo curto COM resultados ⇒ sem atalho', async () => {
    sessionState = authed()
    stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'fe')
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    expect(screen.queryByText(M.gerarAtalhoLead)).not.toBeInTheDocument()
  })

  it('o atalho segue o termo da busca CONCLUÍDA, não o digitado antes do debounce', async () => {
    sessionState = authed()
    stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch()

    const box = screen.getByRole('searchbox')
    await user.type(box, 'feijoada')
    await screen.findByRole('link', { name: atalho('feijoada') })

    // Antes da nova busca concluir, o atalho ainda nomeia o termo dos resultados na tela.
    await user.type(box, ' leve')
    expect(screen.getByRole('link', { name: atalho('feijoada') })).toBeInTheDocument()
    // Concluída a nova busca, acompanha o termo novo.
    await screen.findByRole('link', { name: atalho('feijoada leve') })
  })

  it('símbolos `$` do termo não viram padrões de substituição no rótulo', async () => {
    sessionState = authed()
    stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'bolo $& fubá')
    await screen.findByRole('link', { name: 'Gerar “bolo $& fubá” com IA' })
  })

  it('web desligada ⇒ sem cartão "Buscar na web" no vazio', async () => {
    sessionState = authed()
    stubFetchOk(VAZIO)
    const user = userEvent.setup()
    renderSearch({ webAvailable: false })

    await user.type(screen.getByRole('searchbox'), 'feijao tropeiro')
    await screen.findByRole('link', { name: M.gerarComIa })
    expect(screen.queryByText(M.vazioWebTitulo)).not.toBeInTheDocument()
  })

  it('web desligada ⇒ sem CTA "Buscar na web" ao fim de resultados suficientes', async () => {
    sessionState = authed()
    stubFetchOk(SUFICIENTE)
    const user = userEvent.setup()
    renderSearch({ webAvailable: false })

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('link', { name: atalho('feijoada') })
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
  })

  it('web desligada ⇒ visitante também não vê convite de entrar para a web', async () => {
    sessionState = anon()
    stubFetchOk(VAZIO)
    const user = userEvent.setup()
    renderSearch({ webAvailable: false })

    await user.type(screen.getByRole('searchbox'), 'feijao tropeiro')
    await screen.findByText(M.semResultado)
    expect(screen.queryByText(M.vazioWebTitulo)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.webEntrarBotao })).not.toBeInTheDocument()
  })

  it('web desligada ⇒ visitante sem convite de entrar ao fim de resultados suficientes', async () => {
    sessionState = anon()
    stubFetchOk(SUFICIENTE)
    const user = userEvent.setup()
    renderSearch({ webAvailable: false })

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('link', { name: atalho('feijoada') })
    expect(screen.queryByRole('link', { name: M.webEntrarCta })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: M.webManualCta })).not.toBeInTheDocument()
  })

  it('web desligada ⇒ acervo raso NÃO dispara a descoberta automática', async () => {
    sessionState = authed()
    const fetchMock = stubFetchOk(COM_RESULTADO)
    const user = userEvent.setup()
    renderSearch({ webAvailable: false })

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await screen.findByRole('link', { name: atalho('feijoada') })
    const webCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/discovery/web'))
    expect(webCalls).toHaveLength(0)
  })
})

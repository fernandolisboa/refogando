import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'

const M = ptBR.busca
const MI = ptBR.minhasCriacoes
const NAV = ptBR.nav

function renderSearch() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SearchExperience />
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

describe('SearchExperience — CTA "Gerar com IA" (#166)', () => {
  it('C1 — logado: CTA visível SEM resultados (estado inicial) e leva ao /create', async () => {
    sessionState = authed()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    // Estado inicial neutro: nenhum termo, nenhum resultado — mas o CTA já está lá.
    await screen.findByText(M.dicaInicialLogado)
    const cta = screen.getByRole('link', { name: M.gerarComIa })
    expect(cta).toBeInTheDocument()
    // Sem termo: leva ao /create cru (sem ?q= vazio espúrio).
    expect(cta).toHaveAttribute('href', '/create')
  })

  it('C2 — logado: CTA visível COM resultados e leva ao /create?q=<termo>', async () => {
    sessionState = authed()
    stubFetchOk({
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
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao tropeiro')

    // Há resultados (a seção Catálogo apareceu) E o CTA segue presente.
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    const cta = screen.getByRole('link', { name: M.gerarComIa })
    expect(cta).toBeInTheDocument()
    // O href carrega o termo buscado, URL-encoded (espaço → %20).
    expect(cta).toHaveAttribute('href', '/create?q=feijao%20tropeiro')
  })

  it('C3 — visitante: CTA mostra CONVITE de entrar (não um link pro /create)', async () => {
    sessionState = anon()
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    // O rótulo "Gerar com IA" aparece como título da seção de convite.
    await screen.findByText(M.gerarComIa)
    // NÃO há link pro /create para o visitante.
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()

    // Há um link de "Entrar" levando ao /sign-in (gerar exige conta).
    const signIn = screen.getByRole('link', { name: NAV.signIn })
    expect(signIn).toHaveAttribute('href', '/sign-in')
    // O texto do convite reusa a cópia de minhasCriacoes (mesmo padrão do detalhe da Receita).
    expect(screen.getByText(MI.convidaEntrarTexto)).toBeInTheDocument()
  })

  it('C4 — visitante: convite PERSISTE mesmo com resultados na tela', async () => {
    sessionState = anon()
    stubFetchOk({
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
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijao')
    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })

    // Com resultados, o visitante segue vendo o convite (não vira link).
    const convite = screen.getByText(M.gerarComIa).closest('section')!
    expect(convite).toBeInTheDocument()
    expect(within(convite).getByRole('link', { name: NAV.signIn })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    expect(screen.queryByRole('link', { name: M.gerarComIa })).not.toBeInTheDocument()
  })

  it('C5 — sessão pendente: ramo logado (otimista, sem flash do convite)', async () => {
    sessionState = { ...anon(), isPending: true }
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    // Enquanto resolve, o CTA é o link (não o convite) — evita piscar o convite pra quem
    // já está logado.
    const cta = await screen.findByRole('link', { name: M.gerarComIa })
    expect(cta).toHaveAttribute('href', '/create')
    expect(screen.queryByText(MI.convidaEntrarTexto)).not.toBeInTheDocument()
  })
})

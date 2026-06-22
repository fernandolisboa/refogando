import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'

const M = ptBR.busca

type WebLink = { title: string; url: string; sourceName: string }

function renderSearch() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SearchExperience />
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
function stubFetchRouting(search: SearchResponse, web: WebLink[]) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/discovery/web')) {
      return { ok: true, json: async () => ({ results: web }) }
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
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — descoberta na web (#164)', () => {
  it('W1 — acervo RASO (vazio): mostra a seção "Da web" com links externos marcados', async () => {
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    // A seção "Da web" aparece (heading nível 2 separado).
    const heading = await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(heading).toBeInTheDocument()

    // Cada link é externo: <a> com target=_blank e rel external, abrindo no site de origem. O nome
    // acessível combina título + atribuição ("da web · <fonte>"), então casamos pelo título (regex).
    const link = await screen.findByRole('link', { name: new RegExp(WEB_LINKS[0].title) })
    expect(link).toHaveAttribute('href', WEB_LINKS[0].url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('external')
    expect(link.getAttribute('rel')).toContain('noopener')

    // Atribuição "da web · <fonte>".
    expect(
      screen.getByText(M.daWebFonte.replace('{fonte}', WEB_LINKS[0].sourceName)),
    ).toBeInTheDocument()

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

  it('W4 — links da web NÃO entram no ranking interno (seção própria, não RecipeResultItem)', async () => {
    stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    const link = await screen.findByRole('link', { name: new RegExp(WEB_LINKS[0].title) })
    // O link vive sob a seção "Da web", NÃO sob Catálogo/Comunidade/Minhas.
    const section = link.closest('section')!
    const sectionHeading = section.querySelector('h2')
    expect(sectionHeading?.textContent).toBe(M.secaoDaWeb)
    // E é um link EXTERNO (host de origem), nunca uma rota interna /recipes/<id>.
    expect(link.getAttribute('href')).not.toMatch(/^\/recipes\//)
  })
})

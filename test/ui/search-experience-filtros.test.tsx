import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

/**
 * Teste de COMPONENTE jsdom da TRILHA de filtros (#5 Direção C / #160) — apresentação pura. A trilha é
 * PERMANENTE no desktop (`lg:`) e vira DISCLOSURE no mobile: um botão "Filtros" com `aria-expanded` +
 * `aria-controls="search-filters"`. As 3 facetas (Cozinha/Categoria/Restrição) vivem numa ÚNICA instância
 * no DOM (a `<aside>`); abrir/fechar é puro toggle de visibilidade (CSS) — sem re-disparar nem zerar a
 * busca. O contador de facetas ativas vai no rótulo do botão ("Filtros · N"). jsdom não aplica CSS (sem
 * stylesheet), então as facetas ficam sempre consultáveis — a "recolha" é observada via `aria-expanded`.
 *
 * Espelha os mocks canônicos do `search.test.tsx` (next/link → <a>; useSession → estado
 * mutável). O `setup.ts` já estende o expect com jest-dom e dá os polyfills do Radix.
 */

// next/link precisa do AppRouterContext em runtime; no jsdom mockamos para um <a> simples.
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
  usePathname: () => '/',
}))

// #116: a Busca lê useSession só para a dica inicial. Sem mock o hook bate em /api/auth (quebra
// no jsdom). Anônimo por padrão (basta para os testes de disclosure).
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
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { COZINHA_VOCAB_PT_BR } from '../helpers/cozinha-vocab'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const M = ptBR.busca

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

/** O botão "Filtros" (gatilho mobile do disclosure da trilha). O rótulo carrega a contagem ("Filtros · N"),
 * então casamos por prefixo. Os checkboxes têm role=checkbox (não button) ⇒ não colidem com este getByRole. */
function filtrosButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Filtros/ }) as HTMLButtonElement
}

beforeEach(() => {
  sessionState = anon()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — trilha de filtros (#5 Direção C / #160)', () => {
  it('F1 — RECOLHIDA por padrão no mobile (botão "Filtros" aria-expanded=false) + UMA instância de cada faceta', () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    const btn = filtrosButton()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn).toHaveAttribute('aria-controls', 'search-filters')

    // Contrato CSS-collapse (o jsdom não computa o stylesheet, então fixamos pelas CLASSES): recolhida,
    // a trilha carrega `hidden` (display:none no mobile) — e NÃO a `flex` autônoma (só `lg:flex`). Sem
    // isto, um refactor que removesse o toggle `hidden`/`lg:flex` deixaria o painel sempre aberto no
    // mobile e a suíte seguiria verde.
    const aside = document.getElementById('search-filters')!
    expect(aside.classList.contains('hidden')).toBe(true)
    expect(aside.classList.contains('flex')).toBe(false)

    // As 3 facetas existem (trilha permanente no desktop; o jsdom não esconde por CSS).
    expect(screen.getByText(M.filtroCozinha)).toBeInTheDocument()
    expect(screen.getByText(M.filtroCategoria)).toBeInTheDocument()
    expect(screen.getByText(M.filtroRestricao)).toBeInTheDocument()

    // UMA instância de cada checkbox — guarda contra rail-desktop + drawer-mobile DUPLICADOS (que
    // casariam 2 elementos no jsdom e quebrariam getByLabelText/getByRole nestes 5 arquivos de teste).
    expect(screen.getAllByLabelText('Brasileira')).toHaveLength(1)
    expect(screen.getAllByLabelText(ptBR.categoriaLabel.sobremesa)).toHaveLength(1)
  })

  it('F2 — sem seleção: o rótulo do botão é "Filtros" SEM contador', () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    const btn = filtrosButton()
    expect(btn).toHaveTextContent(M.filtros)
    // Sem facetas ativas, não há contagem ("· N").
    expect(btn.textContent).not.toMatch(/·/)
  })

  it('F3 — o contador reflete a soma das facetas ativas (cozinha+categoria+restrição)', async () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    // Marca uma Cozinha + uma Categoria = 2 facetas ativas (as facetas estão sempre no DOM).
    await user.click(screen.getByLabelText('Brasileira'))
    await user.click(screen.getByLabelText(ptBR.categoriaLabel.sobremesa))

    expect(filtrosButton()).toHaveTextContent(M.filtrosContagem.replace('{count}', '2'))
  })

  it('F4 — abrir/fechar (aria-expanded) PRESERVA a seleção e NÃO re-dispara/zera a busca', async () => {
    const fetchMock = stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    // Marca uma faceta (dispara UMA busca, debounced).
    const chip = screen.getByLabelText('Brasileira') as HTMLInputElement
    await user.click(chip)
    expect(chip).toBeChecked()

    // Espera a busca disparar pela seleção (vence o debounce de 300ms).
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const callsAposSelecao = fetchMock.mock.calls.length

    // Abre o disclosure (mobile): aria-expanded → true; a trilha troca `hidden`→`flex`; seleção sobrevive.
    const aside = document.getElementById('search-filters')!
    await user.click(filtrosButton())
    expect(filtrosButton()).toHaveAttribute('aria-expanded', 'true')
    expect(aside.classList.contains('flex')).toBe(true)
    expect(aside.classList.contains('hidden')).toBe(false)
    expect(screen.getByLabelText('Brasileira')).toBeChecked()

    // Fecha de novo: aria-expanded → false; trilha volta a `hidden`; seleção e contador intactos.
    await user.click(filtrosButton())
    expect(filtrosButton()).toHaveAttribute('aria-expanded', 'false')
    expect(aside.classList.contains('hidden')).toBe(true)
    expect(screen.getByLabelText('Brasileira')).toBeChecked()
    expect(filtrosButton()).toHaveTextContent(M.filtrosContagem.replace('{count}', '1'))

    // Abrir/fechar é PURO toggle de UI: nenhuma busca nova foi disparada.
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock.mock.calls.length).toBe(callsAposSelecao)
  })
})

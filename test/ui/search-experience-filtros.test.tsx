import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

/**
 * Teste de COMPONENTE jsdom do disclosure "+ filtros" (#160) — apresentação pura: recolher
 * as 3 facetas (Cozinha/Categoria/Restrição) atrás de um gatilho NATIVO `<details>/<summary>`,
 * recolhido por padrão, com contador de facetas ativas no rótulo. Sem mudança no contrato da
 * Busca: expandir/recolher só esconde/mostra a seção — não re-dispara nem zera a busca.
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
import { SearchExperience } from '@/components/recipe/search-experience'

const M = ptBR.busca

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

/** O `<details>` que embrulha as facetas (o que tem o summary "+ filtros"). */
function disclosure(): HTMLDetailsElement {
  const summary = screen.getByText((_content, el) => el?.tagName === 'SUMMARY' && /\+ filtros/.test(el.textContent ?? ''))
  return summary.closest('details') as HTMLDetailsElement
}

beforeEach(() => {
  sessionState = anon()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — disclosure "+ filtros" (#160)', () => {
  it('F1 — filtros nascem RECOLHIDOS por padrão (details sem `open`)', () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    const details = disclosure()
    expect(details).toBeInTheDocument()
    expect(details.open).toBe(false)
    // As 3 facetas vivem DENTRO do disclosure (o gatilho é o caminho para elas).
    expect(within(details).getByText(M.filtroCozinha)).toBeInTheDocument()
    expect(within(details).getByText(M.filtroCategoria)).toBeInTheDocument()
    expect(within(details).getByText(M.filtroRestricao)).toBeInTheDocument()
  })

  it('F2 — sem seleção: o rótulo é "+ filtros" SEM contador', () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    renderSearch()

    const summary = within(disclosure()).getByText(M.filtros)
    expect(summary).toBeInTheDocument()
    // Sem facetas ativas, não há contagem entre parênteses.
    expect(summary.textContent).not.toMatch(/\(\d+\)/)
  })

  it('F3 — o contador reflete a soma das facetas ativas (cozinha+categoria+restrição)', async () => {
    stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    // Abre o disclosure para alcançar os chips.
    await user.click(within(disclosure()).getByText(M.filtros))

    // Marca uma Cozinha + uma Categoria = 2 facetas ativas.
    await user.click(screen.getByLabelText(ptBR.cozinhaLabel.brasileira))
    await user.click(screen.getByLabelText(ptBR.categoriaLabel.sobremesa))

    const esperado = M.filtrosContagem.replace('{count}', '2')
    expect(within(disclosure()).getByText(esperado)).toBeInTheDocument()
  })

  it('F4 — recolher/expandir PRESERVA a seleção e NÃO re-dispara/zera a busca', async () => {
    const fetchMock = stubFetchOk({ minhas: [], catalogo: [], comunidade: [] })
    const user = userEvent.setup()
    renderSearch()

    // Abre, marca uma faceta (dispara UMA busca, debounced).
    await user.click(within(disclosure()).getByText(M.filtros))
    const chip = screen.getByLabelText(ptBR.cozinhaLabel.brasileira) as HTMLInputElement
    await user.click(chip)
    expect(chip).toBeChecked()

    // Espera a busca disparar pela seleção (vence o debounce de 300ms).
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const callsAposSelecao = fetchMock.mock.calls.length

    // Recolhe o disclosure (clica no summary com a contagem).
    await user.click(within(disclosure()).getByText(M.filtrosContagem.replace('{count}', '1')))
    expect(disclosure().open).toBe(false)

    // Expande de novo.
    await user.click(within(disclosure()).getByText(M.filtrosContagem.replace('{count}', '1')))
    expect(disclosure().open).toBe(true)

    // A seleção sobreviveu ao recolher/expandir (não foi zerada).
    expect(screen.getByLabelText(ptBR.cozinhaLabel.brasileira)).toBeChecked()
    // O contador segue refletindo a faceta ativa.
    expect(
      within(disclosure()).getByText(M.filtrosContagem.replace('{count}', '1')),
    ).toBeInTheDocument()

    // Recolher/expandir é PURO toggle do <details>: nenhuma busca nova foi disparada.
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock.mock.calls.length).toBe(callsAposSelecao)
  })
})

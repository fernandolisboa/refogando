import { describe, it, expect, vi, afterEach } from 'vitest'
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

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'

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
      <SearchExperience />
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

/** Última URL passada ao fetch, como string. */
function lastFetchUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls.at(-1)
  return String(call?.[0])
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience (#56)', () => {
  it('T1 — buscar termo → seções + selos + links + ordem', async () => {
    const fetchMock = stubFetchOk({
      catalogo: [
        {
          recipeId: 'r1',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
        },
      ],
      comunidade: [
        {
          recipeId: 'r2',
          displayedTitle: 'Strogonoff',
          origin: 'ai_chat',
          autoTranslationSignal: false,
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

    // Item de catalog: selo "Do catálogo" PRESENTE, com classe de accent.
    const feijoadaItem = screen.getByText('Feijoada').closest('li')!
    const catalogBadge = within(feijoadaItem).getByText(M.seloCatalogo)
    expect(catalogBadge).toBeInTheDocument()
    expect(catalogBadge).toHaveClass('bg-accent-surface')
    expect(catalogBadge).toHaveClass('text-accent-strong')

    // Item de comunidade: selo "Da comunidade" PRESENTE (assertion positiva); SEM accent.
    const strogonoffItem = screen.getByText('Strogonoff').closest('li')!
    const communityBadge = within(strogonoffItem).getByText(M.seloComunidade)
    expect(communityBadge).toBeInTheDocument()
    expect(communityBadge).not.toHaveClass('bg-accent-surface')

    // Links para o detalhe canônico /recipes/:id.
    expect(within(feijoadaItem).getByRole('link')).toHaveAttribute('href', '/recipes/r1')
    expect(within(strogonoffItem).getByRole('link')).toHaveAttribute(
      'href',
      '/recipes/r2',
    )
  })

  it('T2 — busca sem resultado → estado neutro, sem erro', async () => {
    stubFetchOk({ catalogo: [], comunidade: [] })
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
    const fetchMock = stubFetchOk({ catalogo: [], comunidade: [] })
    renderSearch()

    await screen.findByText(M.dicaInicial)
    // ESPERA a janela do debounce (300ms) ELAPSAR antes do assert negativo. Sem isso o
    // teste é VÁCUO: o render idle resolve síncrono, mas o timer de doSearch do effect de
    // mount ainda não disparou — então o assert passaria mesmo SEM o early-return `if
    // (!hasCriteria)`. Com o wait, T3 falha se o guarda for removido (mutation-verified).
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T4 — faceta aplicada na query (faceta-only, sem q espúrio)', async () => {
    const fetchMock = stubFetchOk({
      catalogo: [
        {
          recipeId: 'r3',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
        },
      ],
      comunidade: [],
    })
    const user = userEvent.setup()
    renderSearch()

    // Marca o checkbox de Cozinha "Brasileira".
    await user.click(screen.getByLabelText(ptBR.cozinhaLabel.brasileira))

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
      catalogo: [],
      comunidade: [],
      sugestoes: [
        {
          recipeId: 'r9',
          displayedTitle: 'Risoto',
          origin: 'ai_structured',
          autoTranslationSignal: false,
        },
      ],
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'arroz cremoso')

    await screen.findByRole('heading', { name: M.talvezQueira, level: 2 })
    const risotoItem = screen.getByText('Risoto').closest('li')!
    expect(within(risotoItem).getByRole('link')).toHaveAttribute('href', '/recipes/r9')
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
      catalogo: [
        {
          recipeId: 'r1',
          displayedTitle: 'Feijoada',
          origin: 'catalog',
          autoTranslationSignal: false,
        },
      ],
      comunidade: [],
    })
    await user.click(retry)

    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    expect(fetchMock).toHaveBeenCalled()
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
  })
})

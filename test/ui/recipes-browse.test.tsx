import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado.
// Mockamos pra um <a> simples — aqui o que importa é o href de detalhe e o comportamento
// do browse, não a navegação do Next (espelha test/ui/search.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeBrowseExperience } from '@/components/recipe/recipe-browse-experience'

/**
 * Teste de COMPONENTE jsdom do browse /recipes (#98) — seam de frontend da #54 (sem
 * browser/Postgres). Cobre: monta → JÁ busca (`browse=1`, sem digitar) → seções+selos+links;
 * pool vazio → estado neutro; faceta refina (mantém browse=1); ordenação default Popularidade
 * + re-fetch; erro+retry. `fetch` mockado no shape REAL de `SearchResponse`. O fetch é
 * debounced (300ms) + async ⇒ `findBy*`.
 */

const M = ptBR.busca
const MB = ptBR.browse
const MC = ptBR.comunidade

function renderBrowse() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeBrowseExperience />
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

function pool(): SearchResponse {
  return {
    catalogo: [
      { recipeId: 'r1', displayedTitle: 'Feijoada', origin: 'catalog', autoTranslationSignal: false },
    ],
    comunidade: [
      { recipeId: 'r2', displayedTitle: 'Strogonoff', origin: 'ai_chat', autoTranslationSignal: false },
    ],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeBrowseExperience (#98)', () => {
  it('B1 — monta e JÁ lista o pool (browse=1, sem digitar) → seções + selos + links + ordem', async () => {
    const fetchMock = stubFetchOk(pool())
    renderBrowse()

    const catalogoHeading = await screen.findByRole('heading', {
      name: M.secaoCatalogo,
      level: 2,
    })

    // Chamou /api/search com browse=1 e locale — SEM q (não há campo de texto).
    const url = new URL(lastFetchUrl(fetchMock))
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('browse')).toBe('1')
    expect(url.searchParams.get('locale')).toBe('pt-BR')
    expect(url.searchParams.get('q')).toBeNull()

    // Seções presentes, Catálogo antes de Comunidade no DOM.
    const comunidadeHeading = screen.getByRole('heading', { name: M.secaoComunidade, level: 2 })
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings[0]).toBe(catalogoHeading)
    expect(headings[1]).toBe(comunidadeHeading)

    // Selos de proveniência + links para o detalhe canônico /recipes/:id.
    const feijoadaItem = screen.getByText('Feijoada').closest('li')!
    expect(within(feijoadaItem).getByText(M.seloCatalogo)).toBeInTheDocument()
    expect(within(feijoadaItem).getByRole('link')).toHaveAttribute('href', '/recipes/r1')

    const strogonoffItem = screen.getByText('Strogonoff').closest('li')!
    expect(within(strogonoffItem).getByText(M.seloComunidade)).toBeInTheDocument()
    expect(within(strogonoffItem).getByRole('link')).toHaveAttribute('href', '/recipes/r2')
  })

  it('B2 — pool vazio → estado neutro do browse, sem erro e sem headings', async () => {
    stubFetchOk({ catalogo: [], comunidade: [] })
    renderBrowse()

    await screen.findByText(MB.semResultado)
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: M.secaoCatalogo, level: 2 }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: M.secaoComunidade, level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('B3 — marcar faceta refina a query (mantém browse=1)', async () => {
    const fetchMock = stubFetchOk(pool())
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    await user.click(screen.getByLabelText(ptBR.cozinhaLabel.brasileira))

    await vi.waitFor(() => {
      const url = new URL(lastFetchUrl(fetchMock))
      expect(url.searchParams.get('cozinha')).toBe('brasileira')
      // Browse-all NÃO some ao filtrar: o param browse=1 persiste.
      expect(url.searchParams.get('browse')).toBe('1')
    })
  })

  it('B4 — ordenação default Popularidade na 1ª busca; voltar a Relevância re-busca sem sort=', async () => {
    const fetchMock = stubFetchOk(pool())
    const user = userEvent.setup()
    renderBrowse()

    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // O grupo de ordenação é SEMPRE presente (browse sempre tem critério).
    const group = screen.getByRole('group', { name: MC.ordenarPor })
    expect(group).toBeInTheDocument()
    // Default Popularidade: a 1ª URL já carrega sort=popularidade.
    expect(lastFetchUrl(fetchMock)).toContain('sort=popularidade')
    const callsAntes = fetchMock.mock.calls.length

    await user.click(within(group).getByRole('button', { name: MC.toggleRelevancia }))

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAntes)
    })
    expect(lastFetchUrl(fetchMock)).not.toContain('sort=')
  })

  it('B5 — erro de rede → estado de erro + retry recupera', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', failing)

    renderBrowse()

    await screen.findByText(ptBR.system.error)
    const retry = screen.getByRole('button', { name: ptBR.system.retry })
    expect(retry).toBeInTheDocument()

    const fetchMock = stubFetchOk(pool())
    const user = userEvent.setup()
    await user.click(retry)

    await screen.findByRole('heading', { name: M.secaoCatalogo, level: 2 })
    expect(fetchMock).toHaveBeenCalled()
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
  })
})

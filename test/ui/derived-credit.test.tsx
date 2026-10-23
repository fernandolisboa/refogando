import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Crédito na Receita derivada (#610, ADR-0052), pelo lado da UI:
 *  - a linha "Baseada na receita <título> de @handle" (ou "do catálogo") no detalhe, com os dois links;
 *  - o controle do dono da BASE na área de gestão, que só aparece quando a view buscada pela sessão traz
 *    `creditoDoAutor` (o cliente nunca deduz pelo @): retirar / mostrar de novo, e o erro;
 *  - a caixa "Mostrar meu nome nas cópias das minhas receitas" em Editar perfil.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/pt-BR/recipes/minha-moqueca',
}))
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { PortionScaleProvider } from '@/components/recipe/recipe-portion-scale-context'
import { RecipeManagementArea } from '@/components/recipe/recipe-management-area'
import { DerivativeCreditSection } from '@/components/profile/derivative-credit-section'

const C = ptBR.creditoCopias

function view(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Minha moqueca',
    origin: 'user_edited',
    schemaVersion: 1,
    body: { descricao: null, passos: ['Refogue'], notas: null },
    facets: { cozinha: null, categoria: null, tags: [] },
    porcoes: 4,
    dificuldade: 2,
    tempoAtivoMin: null,
    tempoTotalMin: null,
    ingredients: [],
    translations: [],
    autoTranslationSignal: false,
    author: { name: 'Bia', handle: 'bia' },
    ...over,
  } as RecipeView
}

function loggedIn() {
  sessionState = { data: { user: { id: 'u-ana' } }, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
}

type Call = { url: string; method: string; body: unknown }
function mockFetch(handler: (call: Call) => { status: number; body: unknown } | 'reject') {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      const r = handler(call)
      if (r === 'reject') throw new TypeError('network down')
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
    }),
  )
  return calls
}

beforeEach(loggedIn)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('linha de crédito no detalhe', () => {
  function renderDetail(v: RecipeView) {
    return render(
      <PortionScaleProvider originalPorcoes={4}>
        <RecipeDetailView view={v} m={ptBR} locale="pt-BR" />
      </PortionScaleProvider>,
    )
  }

  it('com dona: "Baseada na receita" + título linkando a base + @ linkando o perfil', () => {
    renderDetail(
      view({ basedOn: { titulo: 'Moqueca baiana', href: '/pt-BR/recipes/moqueca-baiana', author: { handle: 'ana' } } }),
    )
    const titulo = screen.getByRole('link', { name: 'Moqueca baiana' })
    expect(titulo).toHaveAttribute('href', '/pt-BR/recipes/moqueca-baiana')
    expect(screen.getByRole('link', { name: '@ana' })).toHaveAttribute('href', '/u/ana')
    expect(titulo.closest('p')).toHaveTextContent(`${C.baseadaEm} Moqueca baiana ${C.de} @ana`)
    // O byline da dona da derivada continua.
    expect(screen.getByRole('link', { name: 'por Bia' })).toBeInTheDocument()
  })

  it('base de catálogo: "… do catálogo", sem @', () => {
    renderDetail(view({ basedOn: { titulo: 'Feijoada', href: '/pt-BR/recipes/feijoada' } }))
    expect(screen.getByRole('link', { name: 'Feijoada' }).closest('p')).toHaveTextContent(
      `${C.baseadaEm} Feijoada ${C.doCatalogo}`,
    )
    expect(screen.queryByRole('link', { name: /^@/ })).toBeNull()
  })

  it('sem `basedOn`: nenhuma linha', () => {
    renderDetail(view())
    expect(screen.queryByText(C.baseadaEm, { exact: false })).toBeNull()
  })
})

describe('controle do dono da base (área de gestão)', () => {
  function renderArea() {
    return render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeManagementArea view={view()} locale="pt-BR" reviewImage={false} />
      </LocaleProvider>,
    )
  }

  it('view buscada com creditoDoAutor: retira e mostra de novo pelo PUT', async () => {
    const calls = mockFetch((call) =>
      call.method === 'PUT'
        ? { status: 200, body: { exibir: (call.body as { exibir: boolean }).exibir } }
        : { status: 200, body: view({ creditoDoAutor: { exibir: true } }) },
    )
    renderArea()
    expect(await screen.findByText(C.seuNome)).toBeInTheDocument()
    // Continua sendo não-dona da derivada: "Criar minha versão" segue lá.
    expect(screen.getByRole('button', { name: ptBR.minhasCriacoes.criarMinhaVersao })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: C.retirar }))
    expect(await screen.findByText(C.retirado)).toBeInTheDocument()
    expect(calls.at(-1)).toEqual({ url: '/api/recipes/r-1/credit', method: 'PUT', body: { exibir: false } })

    await userEvent.click(screen.getByRole('button', { name: C.mostrarDeNovo }))
    expect(await screen.findByText(C.seuNome)).toBeInTheDocument()
    expect(calls.at(-1)?.body).toEqual({ exibir: true })
  })

  it('PUT falha: mensagem de erro e o estado anterior', async () => {
    mockFetch((call) =>
      call.method === 'PUT' ? { status: 500, body: {} } : { status: 200, body: view({ creditoDoAutor: { exibir: true } }) },
    )
    renderArea()
    await userEvent.click(await screen.findByRole('button', { name: C.retirar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(C.erro)
    expect(screen.getByText(C.seuNome)).toBeInTheDocument()
  })

  it('nova busca da view com 404 (a cópia saiu do ar): o controle some', async () => {
    let status = 200
    mockFetch(() => (status === 200 ? { status, body: view({ creditoDoAutor: { exibir: true } }) } : { status, body: {} }))
    const { rerender } = renderArea()
    expect(await screen.findByRole('button', { name: C.retirar })).toBeInTheDocument()
    status = 404
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeManagementArea view={view()} locale="en-US" reviewImage={false} />
      </LocaleProvider>,
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: C.retirar })).toBeNull())
  })

  it('view buscada sem creditoDoAutor: nenhum controle', async () => {
    mockFetch(() => ({ status: 200, body: view() }))
    renderArea()
    expect(await screen.findByRole('button', { name: ptBR.minhasCriacoes.criarMinhaVersao })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: C.retirar })).toBeNull()
  })
})

describe('Editar perfil — crédito nas cópias', () => {
  function renderSection() {
    return render(
      <LocaleProvider initialLocale="pt-BR">
        <DerivativeCreditSection />
      </LocaleProvider>,
    )
  }

  it('carrega a preferência e salva na hora ao desmarcar', async () => {
    const calls = mockFetch((call) =>
      call.method === 'PUT'
        ? { status: 200, body: { creditar: (call.body as { creditar: boolean }).creditar } }
        : { status: 200, body: { creditar: true } },
    )
    renderSection()
    const caixa = await screen.findByRole('checkbox', { name: C.perfilToggle })
    expect(caixa).toBeChecked()
    await userEvent.click(caixa)
    expect(await screen.findByText(C.perfilSalvo)).toBeInTheDocument()
    expect(caixa).not.toBeChecked()
    expect(calls.at(-1)).toEqual({ url: '/api/me/derivative-credit', method: 'PUT', body: { creditar: false } })
  })

  it('erro ao salvar: a caixa volta e a mensagem aparece', async () => {
    mockFetch((call) => (call.method === 'PUT' ? 'reject' : { status: 200, body: { creditar: false } }))
    renderSection()
    const caixa = await screen.findByRole('checkbox', { name: C.perfilToggle })
    expect(caixa).not.toBeChecked()
    await userEvent.click(caixa)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(C.erro))
    expect(caixa).not.toBeChecked()
  })

  it('visitante: nada', () => {
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    const { container } = renderSection()
    expect(container).toBeEmptyDOMElement()
  })
})

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState, type ReactNode } from 'react'

/**
 * Restrições alimentares SALVAS no perfil (ADR-0041), pelo lado da UI: a seção do `/me/profile` (GET/PUT
 * `/api/me/restricoes`) e o DEFAULT pré-marcado — e visivelmente indicado — nas superfícies: wizard
 * estruturado, Prompt aberto, Conversa, Sugestão de cardápio e Busca. Cada pedido pode mudar; Visitante não
 * busca nada. `fetch` mockado por URL no shape real das rotas; `useSession` mockado.
 */

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

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { COZINHA_VOCAB_PT_BR, WithCozinhaVocab } from '../helpers/cozinha-vocab'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { RestricoesPerfilProvider, useRestricoesPerfil } from '@/components/profile/restricoes-perfil-provider'
import { RestricoesPerfilForm } from '@/components/profile/restricoes-perfil-form'
import { CreateDrawer } from '@/components/recipe/create-drawer'
import { MealPlanSuggestPanel } from '@/components/meal-plan/meal-plan-suggest-panel'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const R = ptBR.restricoesPerfil
const D = ptBR.criarDrawer
const W = ptBR.criarWizard
const L = ptBR.restricaoLabel

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
}

type Call = { url: string; method: string; body: Record<string, unknown> | undefined }

/** fetch por URL: `/api/me/restricoes` devolve `salvas` (GET) e ecoa o PUT; o resto, um 200 neutro. */
function mockFetch(salvas: string[], extra: (url: string) => unknown = () => ({})) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body != null ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      calls.push({ url, method, body })
      let payload: unknown = extra(url)
      if (url === '/api/me/restricoes') payload = method === 'PUT' ? { restricoes: body?.restricoes } : { restricoes: salvas }
      return { ok: true, status: 200, json: async () => payload } as Response
    }),
  )
  return calls
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider initialLocale="pt-BR">
      <RestricoesPerfilProvider>{children}</RestricoesPerfilProvider>
    </LocaleProvider>
  )
}

function Drawer() {
  const [open, setOpen] = useState(true)
  return (
    <WithCozinhaVocab>
      <CreateDrawer open={open} onOpenChange={setOpen} />
    </WithCozinhaVocab>
  )
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('Seção "Restrições alimentares" do perfil', () => {
  it('carrega as salvas, edita e grava via PUT; publica o novo default no contexto', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'])
    function Probe() {
      const r = useRestricoesPerfil()
      return <output data-testid="probe">{r == null ? 'nada' : r.join(',')}</output>
    }
    render(
      <Providers>
        <RestricoesPerfilForm />
        <Probe />
      </Providers>,
    )

    const vegano = await screen.findByRole('checkbox', { name: L.vegano })
    expect(vegano).toBeChecked()
    expect(screen.getByText(R.privado)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: L.sem_gluten }))
    await user.click(screen.getByRole('button', { name: R.salvar }))

    expect(await screen.findByText(R.salvo)).toBeInTheDocument()
    const putCall = calls.find((c) => c.method === 'PUT')
    expect(putCall?.body).toEqual({ restricoes: ['sem_gluten', 'vegano'] })
    expect(screen.getByTestId('probe')).toHaveTextContent('sem_gluten,vegano')
  })

  it('Visitante: a seção não renderiza e nada é buscado', () => {
    sessionState = guest()
    const calls = mockFetch(['vegano'])
    render(
      <Providers>
        <RestricoesPerfilForm />
      </Providers>,
    )
    expect(screen.queryByText(R.titulo)).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('Default do perfil na criação', () => {
  it('wizard estruturado: pré-marca as salvas com a indicação; tirar uma vale para o pedido', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano', 'sem_gluten'], (url) =>
      url.includes('/api/generations') ? { outcome: 'impossible', recipeId: null, advisory: null } : {},
    )
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
    await user.type(screen.getByPlaceholderText(/cebola/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))

    expect(await screen.findByText(R.vemDoPerfil)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: L.vegano })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: L.sem_gluten })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: L.sem_gluten }))
    // A seleção passou a ser da pessoa: a indicação "do perfil" some.
    expect(screen.queryByText(R.vemDoPerfil)).toBeNull()

    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    const post = calls.find((c) => c.url.includes('/api/generations'))
    expect((post?.body?.briefing as { restricoes: string[] }).restricoes).toEqual(['vegano'])
  })

  it('Prompt aberto: "Considerar suas restrições" já marcadas; sobem em `restricoes` e podem sair', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['sem_lactose'], (url) =>
      url.includes('/api/generations') ? { outcome: 'impossible', recipeId: null, advisory: null } : {},
    )
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))

    const grupo = await screen.findByRole('group', { name: R.considerarLegenda })
    const chip = within(grupo).getByRole('checkbox', { name: L.sem_lactose })
    expect(chip).toBeChecked()

    await user.type(screen.getByRole('textbox', { name: ptBR.criar.textareaLabel }), 'um risoto de cogumelos')
    await user.click(screen.getByRole('button', { name: ptBR.criar.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    expect(calls.find((c) => c.url.includes('/api/generations'))?.body).toMatchObject({
      mode: 'free_text',
      restricoes: ['sem_lactose'],
    })
  })

  it('Prompt aberto sem nada salvo: a tela fica como antes (sem chips, sem `restricoes`)', async () => {
    const user = userEvent.setup()
    mockFetch([])
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: ptBR.criar.textareaLabel })).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: R.considerarLegenda })).toBeNull()
  })

  it('Conversa: as salvas aparecem marcadas acima do envio', async () => {
    const user = userEvent.setup()
    mockFetch(['vegetariano'])
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoConversaTitulo) }))
    const grupo = await screen.findByRole('group', { name: R.considerarLegenda })
    expect(within(grupo).getByRole('checkbox', { name: L.vegetariano })).toBeChecked()
  })
})

describe('Default do perfil no Cardápio e na Busca', () => {
  const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']

  it('Sugerir com IA: pré-marcadas com a indicação e no pedido', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['low_carb'], (url) =>
      url.startsWith('/api/me/meal-plan/suggestions?') ? { items: [], comentario: '', targetCount: 0 } : {},
    )
    render(
      <Providers>
        <MealPlanSuggestPanel days={DAYS} today="2026-10-08" onApplied={vi.fn()} />
      </Providers>,
    )
    expect(await screen.findByText(R.vemDoPerfil)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: L.low_carb })).toBeChecked()
    await user.click(screen.getByRole('button', { name: ptBR.cardapio.sugerirEnviar }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/me/meal-plan/suggestions?'))).toBe(true))
    expect(calls.find((c) => c.url.startsWith('/api/me/meal-plan/suggestions?'))?.body).toMatchObject({
      restricoes: ['low_carb'],
    })
  })

  it('Busca: o repouso não filtra; ao buscar, filtra pelo perfil COM aviso, e "Mostrar tudo" tira', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'], (url) =>
      url.includes('/api/search') ? { minhas: [], catalogo: [], comunidade: [] } : { cooks: [] },
    )
    render(
      <Providers>
        <CozinhaVocabProvider value={COZINHA_VOCAB_PT_BR}>
          <HomeSearchProvider>
            <HomeSearchBar />
            <SearchExperience />
          </HomeSearchProvider>
        </CozinhaVocabProvider>
      </Providers>,
    )
    // Repouso: nada marcado na trilha, nenhuma busca.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/restricoes')).toBe(true))
    expect(screen.getByRole('checkbox', { name: L.vegano })).not.toBeChecked()
    expect(calls.some((c) => c.url.includes('/api/search?'))).toBe(false)

    await user.type(screen.getByRole('searchbox'), 'bolo')
    const aviso = await screen.findByText(R.buscaAviso.replace('{lista}', L.vegano))
    expect(aviso).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: L.vegano })).toBeChecked()
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/search?') && c.url.includes('restricao=vegano'))).toBe(true),
    )

    await user.click(screen.getByRole('button', { name: R.buscaMostrarTudo }))
    expect(screen.queryByText(R.buscaAviso.replace('{lista}', L.vegano))).toBeNull()
    expect(screen.getByRole('checkbox', { name: L.vegano })).not.toBeChecked()
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes('/api/search?')).at(-1)
      expect(last?.url).not.toContain('restricao=')
    })
  })
})

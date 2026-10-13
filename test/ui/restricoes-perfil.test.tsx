import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState, type ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Restrições alimentares SALVAS no perfil (ADR-0041), pelo lado da UI: a seção do `/me/profile` (GET/PUT
 * `/api/me/restricoes`), o contexto (carga preguiçosa, troca de conta, nova tentativa) e o DEFAULT pré-marcado
 * — e visivelmente indicado — nas superfícies: wizard estruturado, Formulário estruturado/Prompt aberto,
 * Conversa, Sugestão de cardápio e Busca (onde a lista NUNCA vai para URL: só `restricaoPerfil=1`). Cada pedido
 * pode mudar; Visitante não busca nada. `fetch` mockado por URL no shape real das rotas; `useSession` mockado.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
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
import { CreateStructuredExperience } from '@/components/recipe/create-structured-experience'
import { MealPlanSuggestPanel } from '@/components/meal-plan/meal-plan-suggest-panel'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

const R = ptBR.restricoesPerfil
const D = ptBR.criarDrawer
const W = ptBR.criarWizard
const C = ptBR.criar
const CV = ptBR.conversa
const L = ptBR.restricaoLabel

function authed(id = 'u-1'): SessionState {
  return {
    data: { user: { id, name: 'Ana' }, session: { id: `s-${id}` } },
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
/** Resposta da rota: um JSON (payload), ou uma resposta pronta (stream, erro). */
type Rota = (url: string, call: Call) => unknown
const PRONTA = Symbol('pronta')
function pronta(r: Partial<Response>): { [PRONTA]: Partial<Response> } {
  return { [PRONTA]: r }
}

/**
 * fetch por URL: `/api/me/restricoes` devolve `salvas` (GET; pode ser uma Promise para segurar a resposta)
 * e ecoa o PUT; `/api/search?` ecoa `salvas` como `restricoesPerfil` quando vem `restricaoPerfil=1`; o resto
 * passa por `rota` (default: 200 neutro).
 */
function mockFetch(salvas: string[] | (() => Promise<string[]>), rota: Rota = () => ({})) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body != null ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      const call = { url, method, body }
      calls.push(call)
      let payload: unknown
      if (url === '/api/me/restricoes') {
        payload = method === 'PUT' ? { restricoes: body?.restricoes } : { restricoes: typeof salvas === 'function' ? await salvas() : salvas }
      } else if (url.includes('/api/search?')) {
        const lista = typeof salvas === 'function' ? await salvas() : salvas
        payload = {
          minhas: [],
          catalogo: [],
          comunidade: [],
          ...(url.includes('restricaoPerfil=1') && lista.length > 0 ? { restricoesPerfil: lista } : {}),
        }
      } else {
        payload = rota(url, call)
      }
      if (payload != null && typeof payload === 'object' && PRONTA in payload) {
        return (payload as { [PRONTA]: Response })[PRONTA]
      }
      return { ok: true, status: 200, json: async () => payload } as Response
    }),
  )
  return calls
}

const searches = (calls: Call[]) => calls.filter((c) => c.url.includes('/api/search?'))
const perfilGets = (calls: Call[]) => calls.filter((c) => c.url === '/api/me/restricoes' && c.method === 'GET')

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

function Probe({ id = 'probe' }: { id?: string }) {
  const r = useRestricoesPerfil()
  return <output data-testid={id}>{r == null ? 'nada' : r.join(',')}</output>
}

function baseView(): RecipeView {
  return {
    id: 'r-1',
    name: 'Refogado de abobrinha',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Cremoso.', passos: ['Refogue'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'prato_principal', tags: [] },
    porcoes: 2,
    dificuldade: 1,
    ingredients: [{ ordem: 1, quantidade: '1.000', unidade: 'unidade', rawText: 'abobrinha' }],
    translations: [],
    autoTranslationSignal: false,
  } as RecipeView
}

/** Um turno de Conversa que termina em `impossible` (o form volta a ficar disponível). */
function streamDeUmTurno(): Partial<Response> {
  // Cast: o tipo de `Response.body` (Uint8Array<ArrayBuffer>) é mais estreito que o do ReadableStream do jsdom.
  const enc = new TextEncoder()
  const linhas = [{ type: 'token', text: 'Certo.' }, { type: 'impossible', advisory: null }]
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of linhas) c.enqueue(enc.encode(`${JSON.stringify(l)}\n`))
        c.close()
      },
    }),
  } as unknown as Partial<Response>
}

function SearchTree() {
  return (
    <Providers>
      <CozinhaVocabProvider value={COZINHA_VOCAB_PT_BR}>
        <HomeSearchProvider>
          <HomeSearchBar />
          <SearchExperience />
        </HomeSearchProvider>
      </CozinhaVocabProvider>
    </Providers>
  )
}

// #236: a Busca reflete a URL com `window.history.replaceState` (não `router.replace`).
let historyReplace: MockInstance<History['replaceState']>

beforeEach(() => {
  sessionState = authed()
  nav.replace.mockClear()
  historyReplace = vi.spyOn(window.history, 'replaceState')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('Seção "Restrições alimentares" do perfil', () => {
  it('carrega as salvas, edita e grava via PUT; publica o novo default no contexto', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'])
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
    const salvar = screen.getByRole('button', { name: R.salvar })
    // O texto de consentimento é a descrição acessível do botão.
    expect(salvar).toHaveAccessibleDescription(R.consentimento)
    await user.click(salvar)

    expect(await screen.findByText(R.salvo)).toBeInTheDocument()
    const putCall = calls.find((c) => c.method === 'PUT')
    expect(putCall?.body).toEqual({ restricoes: ['sem_gluten', 'vegano'] })
    expect(screen.getByTestId('probe')).toHaveTextContent('sem_gluten,vegano')
  })

  it('falha ao carregar oferece "Tentar de novo"', async () => {
    const user = userEvent.setup()
    let falhar = true
    const calls = mockFetch(['vegano'], () => ({}))
    const fetchOk = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (falhar && String(input) === '/api/me/restricoes') {
          return { ok: false, status: 500, json: async () => ({}) } as Response
        }
        return fetchOk(input, init)
      }),
    )
    render(
      <Providers>
        <RestricoesPerfilForm />
      </Providers>,
    )
    expect(await screen.findByText(R.erroCarregar)).toBeInTheDocument()
    falhar = false
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByRole('checkbox', { name: L.vegano })).toBeChecked()
    expect(calls.length).toBeGreaterThan(0)
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

describe('Contexto das Restrições salvas (carga preguiçosa)', () => {
  it('um GET só, para vários consumidores', async () => {
    const calls = mockFetch(['vegano'])
    render(
      <Providers>
        <Probe id="a" />
        <Probe id="b" />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('vegano'))
    expect(screen.getByTestId('b')).toHaveTextContent('vegano')
    expect(perfilGets(calls)).toHaveLength(1)
  })

  it('Visitante: nenhum GET e nenhum default', () => {
    sessionState = guest()
    const calls = mockFetch(['vegano'])
    render(
      <Providers>
        <Probe />
      </Providers>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('nada')
    expect(calls).toHaveLength(0)
  })

  it('trocar de conta descarta a lista anterior; sair zera', async () => {
    let lista = ['vegano']
    const calls = mockFetch(() => Promise.resolve(lista))
    const { rerender } = render(
      <Providers>
        <Probe />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('vegano'))

    lista = ['sem_gluten']
    sessionState = authed('u-2')
    rerender(
      <Providers>
        <Probe />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('sem_gluten'))
    expect(perfilGets(calls)).toHaveLength(2)

    sessionState = guest()
    rerender(
      <Providers>
        <Probe />
      </Providers>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('nada')
  })

  it('falha do GET (rede ou HTTP) não fica guardada: o próximo consumidor tenta de novo', async () => {
    let modo: 'rede' | 'http' | 'ok' = 'rede'
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        calls.push(String(input))
        if (modo === 'rede') throw new TypeError('network down')
        if (modo === 'http') return { ok: false, status: 500, json: async () => ({}) } as Response
        return { ok: true, status: 200, json: async () => ({ restricoes: ['vegano'] }) } as Response
      }),
    )
    function Consumidores({ n }: { n: number }) {
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <Probe key={i} id={`p${i}`} />
          ))}
        </>
      )
    }
    const { rerender } = render(
      <Providers>
        <Consumidores n={1} />
      </Providers>,
    )
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.getByTestId('p0')).toHaveTextContent('nada')

    modo = 'http'
    rerender(
      <Providers>
        <Consumidores n={2} />
      </Providers>,
    )
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(screen.getByTestId('p1')).toHaveTextContent('nada')

    modo = 'ok'
    rerender(
      <Providers>
        <Consumidores n={3} />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByTestId('p2')).toHaveTextContent('vegano'))
    expect(screen.getByTestId('p0')).toHaveTextContent('vegano')
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

    const hint = await screen.findByText(R.vemDoPerfil)
    // A dica descreve o grupo de chips (o leitor de tela ouve a origem junto).
    expect(screen.getByRole('group', { name: W.restricoesTitulo })).toHaveAttribute('aria-describedby', hint.id)
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

  it('wizard: só o default intocado NÃO basta — briefing vazio, sem gastar geração', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'])
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await screen.findByText(R.vemDoPerfil)
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))

    expect(await screen.findByText(C.erroBriefingVazio)).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(false)
  })

  it('wizard: lista que chega DEPOIS de sair do passo 2 não entra no pedido', async () => {
    const user = userEvent.setup()
    let soltar: (l: string[]) => void = () => {}
    const salvas = new Promise<string[]>((r) => {
      soltar = r
    })
    const calls = mockFetch(
      () => salvas,
      (url) => (url.includes('/api/generations') ? { outcome: 'impossible', recipeId: null, advisory: null } : {}),
    )
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
    await user.type(screen.getByPlaceholderText(/cebola/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    expect(screen.getByRole('button', { name: L.vegano })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: W.continuar }))

    soltar(['vegano'])
    await waitFor(() => expect(perfilGets(calls)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: W.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    const post = calls.find((c) => c.url.includes('/api/generations'))
    expect((post?.body?.briefing as { restricoes: string[] }).restricoes).toEqual([])
  })

  it('wizard: voltar ao passo 2 descongela — a lista que chegou aparece marcada, com a dica', async () => {
    const user = userEvent.setup()
    let soltar: (l: string[]) => void = () => {}
    const salvas = new Promise<string[]>((r) => {
      soltar = r
    })
    const calls = mockFetch(
      () => salvas,
      (url) => (url.includes('/api/generations') ? { outcome: 'impossible', recipeId: null, advisory: null } : {}),
    )
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
    await user.type(screen.getByPlaceholderText(/cebola/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.continuar }))

    soltar(['vegano'])
    await waitFor(() => expect(perfilGets(calls)).toHaveLength(1))
    await user.click(screen.getAllByRole('button', { name: D.voltar }).at(-1)!)
    expect(await screen.findByText(R.vemDoPerfil)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: L.vegano })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    const post = calls.find((c) => c.url.includes('/api/generations'))
    expect((post?.body?.briefing as { restricoes: string[] }).restricoes).toEqual(['vegano'])
  })

  it('wizard: "Criar outra" volta ao default do perfil', async () => {
    const user = userEvent.setup()
    mockFetch(['vegano'], (url) => {
      if (url.includes('/api/generations')) return { outcome: 'success', recipeId: 'r-1', advisory: null }
      if (url.includes('/api/recipes/r-1')) return baseView()
      return {}
    })
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
    await user.type(screen.getByPlaceholderText(/cebola/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await screen.findByText(R.vemDoPerfil)
    await user.click(screen.getByRole('button', { name: L.vegano })) // tira: a seleção é da pessoa
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))

    await user.click(await screen.findByRole('button', { name: C.criarOutra }))
    await user.type(screen.getByPlaceholderText(/cebola/i), 'arroz')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    expect(await screen.findByText(R.vemDoPerfil)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: L.vegano })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Prompt aberto: "Considerar suas restrições" já marcadas; sobem em `restricoes`', async () => {
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
    expect(grupo).toHaveAccessibleDescription(R.considerarDica)
    const chip = within(grupo).getByRole('checkbox', { name: L.sem_lactose })
    expect(chip).toBeChecked()

    await user.type(screen.getByRole('textbox', { name: C.textareaLabel }), 'um risoto de cogumelos')
    await user.click(screen.getByRole('button', { name: C.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    expect(calls.find((c) => c.url.includes('/api/generations'))?.body).toMatchObject({
      mode: 'free_text',
      restricoes: ['sem_lactose'],
    })
  })

  it('Prompt aberto: desmarcar tira `restricoes` do corpo', async () => {
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
    await user.click(within(grupo).getByRole('checkbox', { name: L.sem_lactose }))
    await user.type(screen.getByRole('textbox', { name: C.textareaLabel }), 'um risoto de cogumelos')
    await user.click(screen.getByRole('button', { name: C.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    const body = calls.find((c) => c.url.includes('/api/generations'))?.body
    expect(body).toMatchObject({ mode: 'free_text' })
    expect(body).not.toHaveProperty('restricoes')
  })

  it('Estruturado → Prompt aberto: uma escolha fora do perfil não sobe no Prompt', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'], (url) =>
      url.includes('/api/generations') ? { outcome: 'impossible', recipeId: null, advisory: null } : {},
    )
    render(
      <Providers>
        <WithCozinhaVocab>
          <CreateStructuredExperience />
        </WithCozinhaVocab>
      </Providers>,
    )
    await screen.findByText(R.vemDoPerfil)
    await user.click(screen.getByRole('checkbox', { name: L.sem_lactose }))
    await user.click(screen.getByRole('radio', { name: C.modoPromptAberto }))

    const grupo = await screen.findByRole('group', { name: R.considerarLegenda })
    expect(within(grupo).getByRole('checkbox', { name: L.vegano })).toBeChecked()
    expect(within(grupo).queryByRole('checkbox', { name: L.sem_lactose })).toBeNull()

    await user.type(screen.getByRole('textbox', { name: C.textareaLabel }), 'um risoto de cogumelos')
    await user.click(screen.getByRole('button', { name: C.gerar }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/generations'))).toBe(true))
    expect(calls.find((c) => c.url.includes('/api/generations'))?.body).toMatchObject({ restricoes: ['vegano'] })
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
    await waitFor(() => expect(screen.getByRole('textbox', { name: C.textareaLabel })).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: R.considerarLegenda })).toBeNull()
  })

  it('Conversa: as salvas vão em cada turno; desmarcar tira do turno seguinte', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegetariano'], (url, call) => {
      if (url.includes('/api/creation-sessions') && call.method === 'POST') return { sessionId: 'sess-1' }
      if (url.includes('/api/conversations/stream')) return pronta(streamDeUmTurno())
      return {}
    })
    render(
      <Providers>
        <Drawer />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoConversaTitulo) }))
    const grupo = await screen.findByRole('group', { name: R.considerarLegenda })
    const chip = within(grupo).getByRole('checkbox', { name: L.vegetariano })
    expect(chip).toBeChecked()

    const turnos = () => calls.filter((c) => c.url.includes('/api/conversations/stream'))
    await user.type(screen.getByLabelText(CV.inputLabel), 'quero um jantar leve')
    await user.click(screen.getByRole('button', { name: CV.enviar }))
    await waitFor(() => expect(turnos()).toHaveLength(1))
    expect(turnos()[0].body).toMatchObject({ restricoes: ['vegetariano'] })

    await waitFor(() => expect(screen.getByLabelText(CV.inputLabel)).toBeEnabled())
    await user.click(within(screen.getByRole('group', { name: R.considerarLegenda })).getByRole('checkbox', { name: L.vegetariano }))
    await user.type(screen.getByLabelText(CV.inputLabel), 'pode ter frango')
    await user.click(screen.getByRole('button', { name: CV.enviar }))
    await waitFor(() => expect(turnos()).toHaveLength(2))
    expect(turnos()[1].body).not.toHaveProperty('restricoes')
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

  it('Busca: repouso sem GET nem filtro; ao refinar, pede o perfil SEM valores na URL e mostra o aviso', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'], () => ({ cooks: [] }))
    render(<SearchTree />)

    // Repouso: nada marcado, nenhuma busca e nem o GET das salvas (a home não paga por ele).
    expect(screen.getByRole('checkbox', { name: L.vegano })).not.toBeChecked()
    await new Promise((r) => setTimeout(r, 400))
    expect(searches(calls)).toHaveLength(0)
    expect(perfilGets(calls)).toHaveLength(0)

    await user.type(screen.getByRole('searchbox'), 'bolo')
    const aviso = await screen.findByText(R.buscaAviso.replace('{lista}', L.vegano))
    expect(aviso).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: L.vegano })).toBeChecked()

    const ultima = searches(calls).at(-1)!.url
    expect(ultima).toContain('restricaoPerfil=1')
    expect(ultima).not.toContain('restricao=')
    expect(ultima).not.toContain('vegano')
    // A barra de endereço só reflete o que a pessoa escolheu — nunca o default do perfil.
    expect(historyReplace).toHaveBeenCalled()
    for (const [, , alvo] of historyReplace.mock.calls) expect(String(alvo)).not.toMatch(/restricao|vegano/)
    // Nem o GET das salvas: o eco da Busca basta.
    expect(perfilGets(calls)).toHaveLength(0)
  })

  it('Busca: "Mostrar tudo" tira o filtro, leva o foco aos resultados e vale para a aba', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'], () => ({ cooks: [] }))
    const { unmount } = render(<SearchTree />)

    await user.type(screen.getByRole('searchbox'), 'bolo')
    await user.click(await screen.findByRole('button', { name: R.buscaMostrarTudo }))
    expect(screen.queryByText(R.buscaAviso.replace('{lista}', L.vegano))).toBeNull()
    expect(screen.getByRole('checkbox', { name: L.vegano })).not.toBeChecked()
    // O botão sumiu: o foco não cai no <body>, vai para a região dos resultados.
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(searches(calls).at(-1)?.url).not.toContain('restricaoPerfil'))

    // Voltar à Busca na mesma aba (histórico remonta o componente): o perfil NÃO volta a filtrar.
    unmount()
    const antes = searches(calls).length
    render(<SearchTree />)
    await user.type(screen.getByRole('searchbox'), 'pão')
    await waitFor(() => expect(searches(calls).length).toBeGreaterThan(antes))
    expect(searches(calls).at(-1)?.url).not.toContain('restricaoPerfil')
  })

  it('Busca: Visitante não pede o perfil', async () => {
    sessionState = guest()
    const user = userEvent.setup()
    const calls = mockFetch(['vegano'], () => ({ cooks: [] }))
    render(<SearchTree />)
    await user.type(screen.getByRole('searchbox'), 'bolo')
    await waitFor(() => expect(searches(calls).length).toBeGreaterThan(0))
    expect(searches(calls).at(-1)?.url).not.toContain('restricaoPerfil')
    expect(screen.queryByRole('button', { name: R.buscaMostrarTudo })).toBeNull()
  })
})

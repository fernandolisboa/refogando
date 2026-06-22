import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de COMPONENTE jsdom da tela CRIAR estruturada (#58) — seam de frontend da #54 (sem
 * browser/Postgres). `fetch` é mockado no SHAPE REAL das rotas: `POST /api/generations`
 * (`{ outcome, recipeId, advisory, avisos? }`) e `GET /api/recipes/{id}` (RecipeView CRU,
 * `Response.json(view)` — SEM wrapper `.view`/`.recipe`). Renderiza dentro do LocaleProvider
 * (o componente lê `useLocale`). `next/link` e `@/lib/auth-client` mockados (sem AppRouter/
 * Better Auth no jsdom). Cobre as jornadas: auth, success/degraded/playful/impossible,
 * validação 400, briefing vazio, 502, rede, aviso de restrição em âmbar, e en-US.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// Sessão mutável por teste: autenticada por padrão; anônima no teste de auth.
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

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { CreateStructuredExperience } from '@/components/recipe/create-structured-experience'

const M = ptBR.criar

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function renderCreate(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <CreateStructuredExperience />
    </LocaleProvider>,
  )
}

/** Fixture do GET no shape REAL `RecipeView` (CRU — `Response.json(view)`). */
function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Feijão tropeiro',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Um prato mineiro.', passos: ['Refogue', 'Misture'], notas: null },
    facets: { cozinha: 'mineira', categoria: 'prato_principal', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 1, quantidade: '2.000', unidade: 'xicara', rawText: 'feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

type FetchResult = { status: number; body: unknown } | { reject: true }

/**
 * Mocka `fetch` discriminando por URL: `/api/generations` (POST) e `/api/recipes/` (GET).
 * Cada um pode pendurar a promise via uma factory que devolve `{ promise, release }`, para
 * fixar o estado `loading` sem corrida (anti-vácuo).
 */
function mockFetch(opts: {
  generations: FetchResult | (() => Promise<FetchResult>)
  recipes?: FetchResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.includes('/api/generations')) {
      const r = typeof opts.generations === 'function' ? await opts.generations() : opts.generations
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    if (url.includes('/api/recipes/')) {
      const r = opts.recipes ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    throw new Error(`fetch não mockado: ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function makeResponse(r: { status: number; body: unknown }) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  } as Response
}

/** Cria a "alça" para pendurar a resposta do POST e liberá-la depois. */
function deferred() {
  let release!: (r: FetchResult) => void
  const factory = () => new Promise<FetchResult>((res) => (release = res))
  return { factory, release: (r: FetchResult) => release(r) }
}

/**
 * Textboxes das LINHAS de ingrediente, EXCLUINDO a textarea de entrada inteligente (#112) que
 * agora precede as linhas. Sem isso, `getAllByRole('textbox')[0]` apontaria para a entrada
 * inteligente, não para o rawText do 1º ingrediente. Ordem após o filtro: [0]=rawText#1,
 * [1]=quantidade#1, [2]=observações, …
 */
function ingredientTextboxes(): HTMLElement[] {
  return screen
    .getAllByRole('textbox')
    .filter((el) => el.getAttribute('id') !== 'entrada-inteligente')
}

/** Preenche o briefing mínimo para passar a validação leve: 1 ingrediente. */
async function fillBriefing(user: ReturnType<typeof userEvent.setup>) {
  const inputs = ingredientTextboxes()
  // O primeiro textbox de ingrediente é o rawText do primeiro ingrediente.
  await user.type(inputs[0], 'feijão')
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateStructuredExperience (#58)', () => {
  it('T1 — visitante anônimo vê o convite para entrar, não o formulário', () => {
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    renderCreate()

    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: ptBR.nav.signIn })
    expect(link).toHaveAttribute('href', '/sign-in')

    // Sem formulário (botão gerar ausente) e exatamente UM heading nível 1 (criar.titulo).
    expect(screen.queryByRole('button', { name: M.gerar })).toBeNull()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(M.titulo)
  })

  it('T2 — SUCCESS: submeter → loading desabilitado → GET busca a Receita → RecipeDetailView + CTA "Ver receita"', async () => {
    const user = userEvent.setup()
    const d = deferred()
    const fetchMock = mockFetch({
      generations: d.factory,
      recipes: { status: 200, body: baseView() },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // Loading PENDURADO: o submit está desabilitado, aria-busy, texto "Gerando…".
    const loadingBtn = screen.getByRole('button', { name: M.gerando })
    expect(loadingBtn).toBeDisabled()
    expect(loadingBtn).toHaveAttribute('aria-busy', 'true')

    // Libera a resposta do POST e deixa o GET resolver.
    d.release({ status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } })

    // Resultado: mensagem de sucesso + a Receita montada (heading PELO NOME).
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    const recipeHeading = screen.getByRole('heading', { name: baseView().name })
    expect(recipeHeading).toBeInTheDocument()

    // Exatamente UM heading nível 1, e é o nome da Receita (criar.titulo virou <h2>).
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(baseView().name)

    // CTA "Ver receita" é um LINK que navega pro detalhe (#59) — não escreve nada.
    const verReceita = screen.getByRole('link', { name: M.verReceita })
    expect(verReceita).toHaveAttribute('href', '/recipes/r-1')

    // Corpo da Receita lido CRU: o ingrediente aparece (trava ausência de .view/.recipe).
    expect(screen.getByText(/feijão/)).toBeInTheDocument()

    // Body do POST no shape real.
    const postCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations'))!
    const sent = JSON.parse((postCall[1] as RequestInit).body as string)
    expect(sent.mode).toBe('structured')
    expect(sent.briefing.itens[0]).toMatchObject({
      rawText: 'feijão',
      strength: 'required',
      ingredientId: null,
    })

    // GET chamado com /api/recipes/r-1 e locale=pt-BR.
    const getCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/recipes/'))!
    expect(String(getCall[0])).toContain('/api/recipes/r-1')
    expect(String(getCall[0])).toContain('locale=pt-BR')
  })

  it('T3 — DEGRADED: mensagem de limitação + advisory + Receita', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: {
        status: 201,
        body: { outcome: 'degraded', recipeId: 'r-2', advisory: 'Troquei manteiga por azeite.' },
      },
      recipes: { status: 200, body: baseView({ id: 'r-2' }) },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByText(M.resultadoDegradado)).toBeInTheDocument()
    expect(screen.getByText(/Troquei manteiga por azeite\./)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('T4 — PLAYFUL: comunica brincadeira não-publicável, distinto de erro', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: { status: 201, body: { outcome: 'playful', recipeId: 'r-3', advisory: null } },
      recipes: { status: 200, body: baseView({ id: 'r-3' }) },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByText(M.playfulTitulo)).toBeInTheDocument()
    expect(screen.getByText(M.playfulNota)).toBeInTheDocument()
    // A Receita continua montada (playful renderiza como success).
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    // Cartão playful é NEUTRO (não âmbar) → não há role="note" (Aviso) aqui.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('T5 — IMPOSSIBLE: mensagem clara sem Receita; nunca faz GET; botão tentar de novo', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 200, body: { outcome: 'impossible', advisory: 'Isso não é comida.' } },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByText(M.resultadoImpossivel)).toBeInTheDocument()
    expect(screen.getByText(/Isso não é comida\./)).toBeInTheDocument()
    // Nenhuma Receita: criar.titulo permanece <h1> e é o único heading nível 1.
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(M.titulo)
    expect(screen.getByRole('button', { name: M.tentarNovamente })).toBeInTheDocument()
    // NUNCA chamou o GET de Receita.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('T6 — validação 400 (porções fora da faixa): mensagem localizada neutra, form preservado', async () => {
    const user = userEvent.setup()
    mockFetch({ generations: { status: 400, body: { error: 'porcoes_fora_de_faixa' } } })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroPorcoes)
    expect(alert.className).not.toMatch(/aviso/)
    // Form preservado (briefing não é perdido).
    expect(screen.getByRole('button', { name: M.gerar })).toBeInTheDocument()
  })

  it('T7 — aviso de restrição vindo do GET é exibido em âmbar', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-4', advisory: null } },
      recipes: {
        status: 200,
        body: baseView({
          id: 'r-4',
          avisos: [
            {
              kind: 'contradicao',
              restricao: 'sem_gluten',
              alergeno: 'trigo',
              mensagem: 'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
            },
          ],
          facets: { cozinha: 'italiana', categoria: null, tags: [], restricoes: ['sem_gluten'] },
        }),
      },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(
      'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
    )
    expect(note).toHaveClass('bg-aviso-bg')
  })

  it('T8 — en-US: rótulos do formulário em inglês', () => {
    renderCreate('en-US')
    expect(screen.getByRole('button', { name: enUS.criar.gerar })).toBeInTheDocument()
    // legend "Ingredients" + "Servings" presentes (conteúdo segue o locale resolvido).
    expect(screen.getAllByText(enUS.criar.legendaIngredientes).length).toBeGreaterThan(0)
    expect(screen.getByText(enUS.criar.porcoes)).toBeInTheDocument()
  })

  it('T9 — briefing vazio: só porções/dificuldade não gera, mostra mensagem, não chama fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ generations: { status: 201, body: {} } })
    renderCreate()

    // Preenche SÓ porções (sem ingrediente/cozinha/restrição/observação).
    await user.type(screen.getByLabelText(M.porcoes), '4')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroBriefingVazio)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T10 — erro de geração (502): mensagem neutra, form preservado, sem GET', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 502, body: { outcome: 'invalid', error: 'geracao_invalida' } },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroGeracao)
    expect(alert.className).not.toMatch(/aviso/)
    expect(screen.getByRole('button', { name: M.gerar })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('T10b — teto de geração (429 limite_geracao): mensagem AMIGÁVEL, form preservado, sem GET (#167)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 429, body: { error: 'limite_geracao', retryAfterMs: 3_600_000 } },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroLimiteGeracao) // amigável, distinta de erroGeracao
    expect(alert).not.toHaveTextContent(M.erroGeracao)
    expect(screen.getByRole('button', { name: M.gerar })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('T11 — erro de conexão (rede): catch mostra erroConexao, form preservado', async () => {
    const user = userEvent.setup()
    mockFetch({ generations: { reject: true } })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroConexao)
    expect(alert.className).not.toMatch(/aviso/)
    expect(screen.getByRole('button', { name: M.gerar })).toBeInTheDocument()
  })

  it('T12 — linha parcial (só quantidade, sem ingrediente): orienta (decisão 5), NÃO chama fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ generations: { status: 201, body: {} } })
    renderCreate()

    // Preenche SÓ a quantidade do 1º item (rawText vazio). Textboxes de ingrediente em ordem:
    // [0]=rawText, [1]=quantidade, [2]=observações. A linha parcial deve guiar, não cair.
    const inputs = ingredientTextboxes()
    await user.type(inputs[1], '2')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroIngrediente)
    // Guard retorna ANTES da rede: nenhum POST disparado.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T13 — Receita criada mas GET falha: NÃO mostra "impossível", mostra "criada mas não carregou"', async () => {
    const user = userEvent.setup()
    // POST sucede (Receita persistida, recipeId não-null) mas o GET do corpo cai (404/reject).
    mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-9', advisory: null } },
      recipes: { reject: true },
    })
    renderCreate()

    await fillBriefing(user)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // Estado dedicado: "criada, está no seu espaço, mas não carregou" — com botão de recarregar.
    expect(await screen.findByText(M.erroCarregarReceita)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.tentarCarregarNovamente })).toBeInTheDocument()
    // CRÍTICO: NÃO exibe a mensagem de "impossível" (que induziria reenvio → geração duplicada).
    expect(screen.queryByText(M.resultadoImpossivel)).toBeNull()
  })
})

/**
 * Modo prompt aberto (#88) — texto livre → Receita. O mesmo componente, com uma alternância
 * de modo (`SortToggle` reusado) e um ramo de entrada por `textarea`. O backend aceita
 * `mode:'free_text'` em `POST /api/generations` e devolve o MESMO shape do estruturado, então
 * o pipeline de resultado/erro/avisos é o COMPARTILHADO (reusa `baseView`/`mockFetch`).
 */
describe('CreateStructuredExperience — prompt aberto (#88)', () => {
  /** Clica no item "Prompt aberto" (radio do ToggleGroup) do grupo de alternância de modo. */
  async function irParaPromptAberto(user: ReturnType<typeof userEvent.setup>) {
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    await user.click(within(grupo).getByRole('radio', { name: M.modoPromptAberto }))
  }

  it('F1 — alternância preserva o ramo oposto + a11y (aria-checked, heading única)', async () => {
    const user = userEvent.setup()
    renderCreate()

    // Modo estruturado (default): textarea de texto livre AUSENTE, campos presentes.
    expect(screen.queryByLabelText(M.textareaLabel)).toBeNull()
    const inputs = ingredientTextboxes()
    await user.type(inputs[0], 'feijão')

    // Troca para prompt aberto via o grupo de alternância.
    await irParaPromptAberto(user)

    // Textarea + placeholder presentes; campos estruturados sumiram.
    const textarea = screen.getByLabelText(M.textareaLabel)
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', M.textareaPlaceholder)
    expect(screen.queryByText(M.legendaIngredientes)).toBeNull()

    // aria-checked: 'Prompt aberto' ativo, 'Estruturado' inativo (ToggleGroup → role=radio).
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    expect(within(grupo).getByRole('radio', { name: M.modoPromptAberto })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(grupo).getByRole('radio', { name: M.modoEstruturado })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    // Volta para estruturado: o trabalho 'feijão' está preservado (sem perda) e o aria-checked inverte.
    await user.click(within(grupo).getByRole('radio', { name: M.modoEstruturado }))
    expect(screen.getByDisplayValue('feijão')).toBeInTheDocument()
    expect(within(grupo).getByRole('radio', { name: M.modoEstruturado })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(grupo).getByRole('radio', { name: M.modoPromptAberto })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    // Invariante: exatamente UM heading nível 1 em todo o fluxo.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('F2 — POST body { mode:free_text, freeText } (SEM locale) + sucesso', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-7', advisory: null } },
      recipes: { status: 200, body: baseView({ id: 'r-7' }) },
    })
    renderCreate()

    await irParaPromptAberto(user)
    const textarea = screen.getByLabelText(M.textareaLabel)
    await user.type(textarea, '  bolo de cenoura sem glúten  ')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // Sucesso: mensagem + Receita montada (heading pelo nome).
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()

    // Body do POST no shape real: mode='free_text', freeText TRIMADO, e SEM `locale` (código morto).
    const postCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations'))!
    const sent = JSON.parse((postCall[1] as RequestInit).body as string)
    expect(sent.mode).toBe('free_text')
    expect(sent.freeText).toBe('bolo de cenoura sem glúten')
    expect(sent).not.toHaveProperty('locale')
    expect(sent).not.toHaveProperty('briefing')
  })

  it('F3 — aviso de restrição (âmbar) vindo do GET, também no prompt aberto', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-8', advisory: null } },
      recipes: {
        status: 200,
        body: baseView({
          id: 'r-8',
          avisos: [
            {
              kind: 'contradicao',
              restricao: 'sem_gluten',
              alergeno: 'trigo',
              mensagem: 'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
            },
          ],
          facets: { cozinha: 'italiana', categoria: null, tags: [], restricoes: ['sem_gluten'] },
        }),
      },
    })
    renderCreate()

    await irParaPromptAberto(user)
    await user.type(screen.getByLabelText(M.textareaLabel), 'pão sem glúten com farinha de trigo')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(
      'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
    )
    expect(note).toHaveClass('bg-aviso-bg')
  })

  it('F4 — texto curto: botão desabilitado + submit programático cai em erroTextoVazio neutro, sem fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ generations: { status: 201, body: {} } })
    const { container } = renderCreate()

    await irParaPromptAberto(user)
    await user.type(screen.getByLabelText(M.textareaLabel), 'oi') // < FREE_TEXT_MIN (10)

    // UX: o botão Gerar está desabilitado (< mínimo).
    expect(screen.getByRole('button', { name: M.gerar })).toBeDisabled()

    // Botão disabled ⇒ user.click é no-op; disparar o submit do form exercita o ramo `free_text_vazio`.
    const form = container.querySelector('form')!
    fireEvent.submit(form)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroTextoVazio)
    expect(alert.className).not.toMatch(/aviso/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('F5 — texto longo: ultrapassa o limite → erroTextoMuitoLongo neutro, sem fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ generations: { status: 201, body: {} } })
    renderCreate()

    await irParaPromptAberto(user)
    // fireEvent.change ignora maxLength e é instantâneo (user.type de 2001 chars seria lento).
    const textarea = screen.getByLabelText(M.textareaLabel)
    fireEvent.change(textarea, { target: { value: 'a'.repeat(2001) } })

    // Sinal PROATIVO antes do submit: ao passar o teto, a textarea fica aria-invalid (o
    // contador também muda, mas aria-invalid é a âncora acessível verificável).
    expect(textarea).toHaveAttribute('aria-invalid', 'true')

    // >= MIN ⇒ botão habilitado; o limite máximo é barrado pela validação leve no submit.
    const gerar = screen.getByRole('button', { name: M.gerar })
    expect(gerar).toBeEnabled()
    await user.click(gerar)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroTextoMuitoLongo)
    expect(alert.className).not.toMatch(/aviso/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('F9 — erro de um modo NÃO vaza para o outro: alternar de modo descarta o alerta', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ generations: { status: 201, body: {} } })
    const { container } = renderCreate()

    // Dispara um erro no modo prompt aberto (texto curto + submit programático).
    await irParaPromptAberto(user)
    await user.type(screen.getByLabelText(M.textareaLabel), 'oi') // < FREE_TEXT_MIN
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroTextoVazio)

    // Alternar para Estruturado deve DESCARTAR o alerta (a mensagem era do ramo free_text).
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    await user.click(within(grupo).getByRole('radio', { name: M.modoEstruturado }))
    expect(screen.queryByRole('alert')).toBeNull()

    // Nenhum fetch foi disparado em todo o fluxo (guards retornam antes da rede).
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('F6 — impossible no prompt aberto: mensagem clara sem Receita, sem GET, heading única', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 200, body: { outcome: 'impossible', advisory: 'Isso não é comida.' } },
    })
    renderCreate()

    await irParaPromptAberto(user)
    await user.type(screen.getByLabelText(M.textareaLabel), 'uma receita de tijolos cozidos')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByText(M.resultadoImpossivel)).toBeInTheDocument()
    expect(screen.getByText(/Isso não é comida\./)).toBeInTheDocument()
    // Sem Receita: criar.titulo permanece <h1> e é o único heading nível 1.
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(M.titulo)
    // NUNCA chamou o GET de Receita.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('F7 — sanidade do estruturado: o refator do submit não quebrou #58', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } },
      recipes: { status: 200, body: baseView() },
    })
    renderCreate()

    await fillBriefing(user) // permanece no modo estruturado (default)
    await user.click(screen.getByRole('button', { name: M.gerar }))

    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    const postCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations'))!
    const sent = JSON.parse((postCall[1] as RequestInit).body as string)
    expect(sent.mode).toBe('structured')
    expect(sent.briefing.itens[0]).toMatchObject({ rawText: 'feijão' })
  })

  it('F8 — en-US: rótulos de modo e da textarea seguem o locale', async () => {
    const user = userEvent.setup()
    renderCreate('en-US')

    const grupo = screen.getByRole('radiogroup', { name: enUS.criar.modoLegenda })
    expect(within(grupo).getByRole('radio', { name: enUS.criar.modoEstruturado })).toBeInTheDocument()
    await user.click(within(grupo).getByRole('radio', { name: enUS.criar.modoPromptAberto }))

    expect(screen.getByLabelText(enUS.criar.textareaLabel)).toBeInTheDocument()
  })
})

describe('CreateStructuredExperience — pré-preenchimento via ?q (#166)', () => {
  /** Render com a semente `initialFreeText` (o que o CreatePageClient injeta a partir de ?q). */
  function renderWithSeed(initialFreeText?: string, locale: Locale = 'pt-BR') {
    return render(
      <LocaleProvider initialLocale={locale}>
        <CreateStructuredExperience initialFreeText={initialFreeText} />
      </LocaleProvider>,
    )
  }

  it('Q1 — com termo: abre no PROMPT ABERTO com o texto livre pré-preenchido', () => {
    renderWithSeed('feijão tropeiro mineiro')

    // O modo é Prompt aberto (a textarea de texto livre está montada).
    const textarea = screen.getByLabelText(M.textareaLabel)
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('feijão tropeiro mineiro')

    // aria-checked confirma que o modo ativo é Prompt aberto (não Estruturado).
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    expect(within(grupo).getByRole('radio', { name: M.modoPromptAberto })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('Q2 — o campo pré-preenchido segue EDITÁVEL (semente, não trava)', async () => {
    const user = userEvent.setup()
    renderWithSeed('bolo de cenoura')

    const textarea = screen.getByLabelText(M.textareaLabel)
    await user.clear(textarea)
    await user.type(textarea, 'bolo de fubá')
    expect(textarea).toHaveValue('bolo de fubá')
  })

  it('Q3 — sem termo: comportamento INALTERADO (abre no Estruturado, sem textarea)', () => {
    renderWithSeed(undefined)

    // Modo estruturado (default): a textarea de texto livre NÃO está montada.
    expect(screen.queryByLabelText(M.textareaLabel)).toBeNull()
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    expect(within(grupo).getByRole('radio', { name: M.modoEstruturado })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('Q4 — termo só com espaços: tratado como vazio (abre no Estruturado)', () => {
    renderWithSeed('   ')
    expect(screen.queryByLabelText(M.textareaLabel)).toBeNull()
  })
})

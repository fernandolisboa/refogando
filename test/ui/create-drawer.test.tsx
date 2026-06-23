import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de COMPONENTE jsdom do drawer "Nova receita" (#191, ADR-0021). Cobre o SHELL do drawer
 * (Sheet/Radix Dialog), o método-picker (3 cards) e o caminho Prompt aberto (`free_text`)
 * ponta-a-ponta. `fetch` é mockado no SHAPE REAL das rotas (espelha create-structured.test.tsx):
 * `POST /api/generations` (`{ outcome, recipeId, advisory, avisos? }`) e `GET /api/recipes/{id}`
 * (RecipeView CRU). `next/link` e `@/lib/auth-client` mockados (sem AppRouter/Better Auth).
 *
 * Foco em: navegação do picker, seed por `?q`/`?resume`/`?mode=conversa`, estados gerando/gerada,
 * cap/erro/retry, o foco-no-título-da-Receita ao gerar (dentro do drawer) e a invariante de 1-h1.
 * Os polyfills de ponteiro do Radix vêm de test/ui/setup.ts.
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

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { CreateDrawer } from '@/components/recipe/create-drawer'

const D = ptBR.criarDrawer
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

/** Casca controlada: monta o drawer aberto e expõe o estado open para asseverar fechamento. */
function Harness(props: {
  locale?: Locale
  initialQ?: string
  resumeSessionId?: string
  conversaHint?: boolean
  defaultOpen?: boolean
}) {
  const { locale = 'pt-BR', defaultOpen = true, ...seed } = props
  const [open, setOpen] = useState(defaultOpen)
  return (
    <LocaleProvider initialLocale={locale}>
      <button type="button" onClick={() => setOpen(true)}>
        abrir-externo
      </button>
      <CreateDrawer open={open} onOpenChange={setOpen} {...seed} />
    </LocaleProvider>
  )
}

function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Refogado de abobrinha',
    origin: 'ai_free_text',
    schemaVersion: 1,
    body: { descricao: 'Cremoso por dentro.', passos: ['Refogue', 'Misture'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'prato_principal', tags: [] },
    porcoes: 2,
    dificuldade: 1,
    ingredients: [{ ordem: 1, quantidade: '1.000', unidade: 'unidade', rawText: 'abobrinha' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

type FetchResult = { status: number; body: unknown } | { reject: true }

function makeResponse(r: { status: number; body: unknown }) {
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
}

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

/** Alça para pendurar a resposta do POST e liberá-la (fixa o estado loading sem corrida). */
function deferred() {
  let release!: (r: FetchResult) => void
  const factory = () => new Promise<FetchResult>((res) => (release = res))
  return { factory, release: (r: FetchResult) => release(r) }
}

/** Acha o painel do drawer (role=dialog). */
function drawer() {
  return screen.getByRole('dialog')
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateDrawer — "Nova receita" (#191)', () => {
  it('D1 — abre no método-picker com os 3 cards e o kicker; sem chamar fetch', () => {
    render(<Harness />)

    const dialog = drawer()
    expect(dialog).toHaveAccessibleName(D.tituloPicker)
    // Os 3 cards do método-picker.
    expect(within(dialog).getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: new RegExp(D.metodoPromptTitulo) })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: new RegExp(D.metodoConversaTitulo) })).toBeInTheDocument()
  })

  it('D2 — escolher "Prompt aberto" mostra a textarea de texto livre; "Voltar" retorna ao picker', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))

    // A textarea de texto livre (#88) aparece; o título do diálogo vira "Prompt aberto".
    expect(screen.getByLabelText(M.textareaLabel)).toBeInTheDocument()
    expect(drawer()).toHaveAccessibleName(D.tituloPrompt)

    // "Voltar" volta ao método-picker (sem fechar o drawer).
    await user.click(screen.getByRole('button', { name: D.voltar }))
    expect(screen.queryByLabelText(M.textareaLabel)).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) })).toBeInTheDocument()
  })

  it('D3 — seed por ?q abre direto no Prompt aberto com o termo preenchido', () => {
    render(<Harness initialQ="curry vegano de grão-de-bico" />)

    const textarea = screen.getByLabelText(M.textareaLabel)
    expect(textarea).toHaveValue('curry vegano de grão-de-bico')
    expect(drawer()).toHaveAccessibleName(D.tituloPrompt)
  })

  it('D4 — ?resume roteia pro caminho Conversa (placeholder "em breve"), sem quebrar', () => {
    render(<Harness resumeSessionId="sess-9" />)
    expect(screen.getByText(D.emBreveConversa)).toBeInTheDocument()
    expect(drawer()).toHaveAccessibleName(D.tituloConversa)
  })

  it('D4b — ?mode=conversa roteia pro caminho Conversa (placeholder), sem quebrar', () => {
    render(<Harness conversaHint />)
    expect(screen.getByText(D.emBreveConversa)).toBeInTheDocument()
  })

  it('D5 — Prompt aberto ponta-a-ponta: gerando → gerada; "Ver receita" leva ao detalhe', async () => {
    const user = userEvent.setup()
    const d = deferred()
    mockFetch({ generations: d.factory, recipes: { status: 200, body: baseView() } })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // Estado GERANDO: o botão vira "Gerando receita…".
    expect(await screen.findByRole('button', { name: M.gerando })).toBeInTheDocument()

    // Libera o POST (201) → segue pro GET (200) → estado GERADA.
    d.release({ status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } })

    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    // "Ver receita" leva ao detalhe da Receita criada.
    expect(screen.getByRole('link', { name: M.verReceita })).toHaveAttribute('href', '/recipes/r-1')
  })

  it('D6 — ao gerar dentro do drawer: foco move pro topo do resultado e o nome da Receita é o ÚNICO <h1>', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } },
      recipes: { status: 200, body: baseView() },
    })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    // O nome da Receita é o ÚNICO <h1> (invariante 1-h1 preservada DENTRO do drawer; o
    // SheetTitle é um <h2> e o `criar.titulo` REBAIXA para <h2> quando há Receita).
    const h1 = await screen.findByRole('heading', { level: 1, name: baseView().name })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    // O foco NÃO ficou preso no painel/scrim do Radix (`SheetContent`/focus-guard): o seam de
    // heading do componente interno o moveu para o heading no TOPO da região de resultado (o
    // `criar.titulo`, agora <h2>, imediatamente acima da Receita) — teclado lê o resultado do
    // começo, não cai no <body> nem fica no contêiner do diálogo.
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null
      expect(active?.tagName).toBe('H2')
      expect(active).toHaveTextContent(M.titulo)
    })
  })

  it('D7 — cap 429 (limite_geracao): mensagem AMIGÁVEL in-drawer, form NÃO trava, sem GET', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 429, body: { error: 'limite_geracao', retryAfterMs: 3_600_000 } },
    })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroLimiteGeracao)
    expect(alert).not.toHaveTextContent(M.erroGeracao)
    // Form não trava: o botão "Gerar receita" segue acionável.
    expect(screen.getByRole('button', { name: M.gerar })).toBeEnabled()
    // 429 é checado antes da IA → nunca toca o GET da Receita (não consumiu cap).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('D8 — 502/erro de geração: alerta neutro + retry; segundo submit re-tenta', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 502, body: { outcome: 'invalid', error: 'geracao_invalida' } },
    })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroGeracao)
    // Retry: o botão "Gerar receita" segue lá — re-submeter dispara um novo POST.
    const callsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/generations')).length
    await user.click(screen.getByRole('button', { name: M.gerar }))
    await waitFor(() => {
      const callsAfter = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/generations')).length
      expect(callsAfter).toBe(callsBefore + 1)
    })
  })

  it('D9 — ESC DURANTE a geração NÃO fecha o drawer (aberto e bloqueante, ADR-0021 dec.5): o painel segue aberto, "gerando" permanece e nenhum 2o POST dispara', async () => {
    // Fechar no meio orfanaria o POST (o servidor conclui, cria a Receita e consome cap, mas o
    // usuário não vê). O drawer trava o dismiss enquanto `status === 'loading'` (sinalizado pelo
    // inner via `onLoadingChange`). Não há cancel/abort — a geração é bounded por maxDuration=60.
    const user = userEvent.setup()
    const d = deferred()
    const fetchMock = mockFetch({ generations: d.factory, recipes: { status: 200, body: baseView() } })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))
    expect(await screen.findByRole('button', { name: M.gerando })).toBeInTheDocument()

    // ESC com o POST ainda in-flight: o dismiss é BLOQUEADO — o drawer continua aberto.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // O estado "gerando" permanece (a geração não foi interrompida nem desmontada).
    expect(screen.getByRole('button', { name: M.gerando })).toBeInTheDocument()

    // Libera a resposta tardia → o fluxo conclui normalmente, DENTRO do mesmo drawer. Nenhum
    // segundo POST foi disparado (sem re-entrada/duplicação).
    d.release({ status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } })
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    const posts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/generations')).length
    expect(posts).toBe(1)
  })

  it('D9b — resolvida a geração, o dismiss volta a funcionar (o bloqueio é SÓ durante o loading)', async () => {
    const user = userEvent.setup()
    const d = deferred()
    mockFetch({ generations: d.factory, recipes: { status: 200, body: baseView() } })
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'um refogado de abobrinha sem cebola')
    await user.click(screen.getByRole('button', { name: M.gerar }))
    expect(await screen.findByRole('button', { name: M.gerando })).toBeInTheDocument()

    // Conclui a geração → sai do estado loading.
    d.release({ status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } })
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()

    // Agora ESC fecha normalmente (não há geração em voo).
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('D10 — reabrir o drawer reseta o wizard ao método-picker (estado limpo entre aberturas)', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Entra no Prompt aberto e digita.
    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoPromptTitulo) }))
    await user.type(screen.getByLabelText(M.textareaLabel), 'rascunho que deve sumir')

    // Fecha e reabre pelo botão externo.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'abrir-externo' }))

    // Reabriu no método-picker (não no Prompt aberto com o rascunho).
    expect(drawer()).toHaveAccessibleName(D.tituloPicker)
    expect(screen.queryByLabelText(M.textareaLabel)).toBeNull()
  })

  it('D11 — en-US: o picker e os cards aparecem traduzidos (paridade i18n, ADR-0001)', () => {
    render(<Harness locale="en-US" />)
    expect(drawer()).toHaveAccessibleName(enUS.criarDrawer.tituloPicker)
    expect(
      screen.getByRole('button', { name: new RegExp(enUS.criarDrawer.metodoPromptTitulo) }),
    ).toBeInTheDocument()
  })
})

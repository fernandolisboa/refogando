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
const CV = ptBR.conversa

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

// ── Caminho Conversa (#194): stream NDJSON + destilação ─────────────────────────────────────
type ChatFrame =
  | { type: 'token'; text: string }
  | { type: 'recipe'; outcome: 'success' | 'degraded' | 'playful'; recipeId: string | null; advisory: string | null }
  | { type: 'impossible'; advisory: string | null }
  | { type: 'error'; error: 'geracao_invalida' | 'conflito_concorrente' }

/** Controlador de stream NDJSON: enfileira linhas e fecha (queda quando sem terminal). */
function makeStreamController() {
  const encoder = new TextEncoder()
  const queue: Uint8Array[] = []
  let closed = false
  let wake: (() => void) | null = null
  const bump = () => {
    if (wake) {
      const w = wake
      wake = null
      w()
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (queue.length === 0 && !closed) await new Promise<void>((res) => (wake = res))
      if (queue.length > 0) {
        controller.enqueue(queue.shift()!)
        return
      }
      controller.close()
    },
  })
  return {
    stream,
    push(frame: ChatFrame) {
      queue.push(encoder.encode(JSON.stringify(frame) + '\n'))
      bump()
    },
    close() {
      closed = true
      bump()
    },
  }
}

type StreamCtrl = ReturnType<typeof makeStreamController>
type JsonResult = { status: number; body: unknown } | { reject: true }

/**
 * Mock de `fetch` no shape REAL das rotas do Modo conversa (espelha conversation.test.tsx):
 * `POST /api/conversations/stream` → ReadableStream NDJSON (ou 429/falha pré-stream);
 * `POST /api/creation-sessions` → {sessionId}; `GET /api/creation-sessions/{id}` → retomada;
 * `GET /api/recipes/{id}` → RecipeView (2º GET).
 */
function mockConversaFetch(opts: {
  stream?: StreamCtrl | (() => Promise<StreamCtrl>) | JsonResult
  createSession?: JsonResult
  recipes?: JsonResult
  resume?: JsonResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/api/conversations/stream')) {
      const s = typeof opts.stream === 'function' ? await opts.stream() : opts.stream
      if (s && 'reject' in s) throw new TypeError('network down')
      if (s && 'status' in s) {
        return { ok: s.status >= 200 && s.status < 300, status: s.status, body: null, json: async () => s.body } as unknown as Response
      }
      const ctrl = s as StreamCtrl
      return { ok: true, status: 200, body: ctrl.stream } as unknown as Response
    }
    if (url.includes('/api/creation-sessions/') && method === 'GET') {
      const r = opts.resume ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    if (url.includes('/api/creation-sessions') && method === 'POST') {
      const r = opts.createSession ?? { status: 201, body: { sessionId: 'sess-1' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    if (url.includes('/api/recipes/')) {
      const r = opts.recipes ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
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

  it('D4 — ?resume roteia pro caminho Conversa (Modo conversa), reidratando a retomada', async () => {
    // O drawer abre direto no Modo conversa; a retomada (#15) reidrata o transcript via GET.
    mockConversaFetch({
      resume: {
        status: 200,
        body: {
          session: { id: 'sess-9', mode: 'conversation', recipeId: null },
          recipe: null,
          transcript: [{ role: 'user', content: 'oi de novo', seq: 0 }],
          advisory: null,
        },
      },
    })
    render(<Harness resumeSessionId="sess-9" />)
    expect(drawer()).toHaveAccessibleName(D.tituloConversa)
    // A retomada reidratou o transcript; o placeholder "em breve" NÃO aparece mais.
    expect(await screen.findByText('oi de novo')).toBeInTheDocument()
    expect(screen.queryByText(D.emBreveConversa)).toBeNull()
  })

  it('D4b — ?mode=conversa abre no Modo conversa idle: input do chat e SEM <h1> (invariante)', () => {
    render(<Harness conversaHint />)
    expect(drawer()).toHaveAccessibleName(D.tituloConversa)
    // O chat está disponível (input + intro); o placeholder antigo sumiu.
    expect(screen.getByLabelText(CV.inputLabel)).toBeInTheDocument()
    expect(screen.getByText(D.conversaIntro)).toBeInTheDocument()
    expect(screen.queryByText(D.emBreveConversa)).toBeNull()
    // INVARIANTE (#194): Conversa idle NÃO tem <h1> (o SheetTitle é o <h2> do diálogo).
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
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

describe('CreateDrawer — caminho Conversa (#194)', () => {
  /** Digita no input do chat e clica em Enviar. */
  async function enviar(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(screen.getByLabelText(CV.inputLabel), text)
    await user.click(screen.getByRole('button', { name: CV.enviar }))
  }

  it('CD1 — escolher "Conversa" abre o chat (sem <h1> idle); fetch não é chamado até enviar', async () => {
    const user = userEvent.setup()
    const fetchMock = mockConversaFetch({})
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: new RegExp(D.metodoConversaTitulo) }))

    expect(drawer()).toHaveAccessibleName(D.tituloConversa)
    expect(screen.getByLabelText(CV.inputLabel)).toBeInTheDocument()
    // INVARIANTE (#194): Conversa idle NÃO tem <h1>.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    // Nenhum fetch até o usuário enviar uma mensagem.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('CD2 — enviar mensagem usa o stream NDJSON e a IA responde com tokens incrementais', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockConversaFetch({
      stream: ctrl,
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
    })
    render(<Harness conversaHint />)

    await enviar(user, 'quero um feijão tropeiro')
    expect(await screen.findByText('quero um feijão tropeiro')).toBeInTheDocument()

    // Tokens incrementais visíveis ANTES de qualquer terminal.
    ctrl.push({ type: 'token', text: 'Vamos ' })
    expect(await screen.findByText('Vamos')).toBeInTheDocument()
    ctrl.push({ type: 'token', text: 'fazer feijão.' })
    expect(await screen.findByText('Vamos fazer feijão.')).toBeInTheDocument()
    ctrl.close()

    // O POST do stream foi exercido (NDJSON reusado, não reimplementado).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/conversations/stream'))).toBe(true)
  })

  it('CD3 — "Destilar receita" gera a Receita e cai em gerada (nome = único <h1>; Ver receita)', async () => {
    const user = userEvent.setup()
    let ctrl = makeStreamController()
    const fetchMock = mockConversaFetch({
      stream: () => Promise.resolve(ctrl),
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView({ id: 'r-1', name: 'Feijão tropeiro', origin: 'ai_chat' }) },
    })
    render(<Harness conversaHint />)

    // 1º turno (conversa).
    await enviar(user, 'quero um feijão tropeiro')
    ctrl.push({ type: 'token', text: 'Beleza.' })
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: null, advisory: null })
    ctrl.close()
    await screen.findByText('Beleza.')

    // "Destilar receita" → re-POSTa o transcript; o servidor decide o terminal recipe → gerada.
    ctrl = makeStreamController()
    await user.click(screen.getByRole('button', { name: D.destilarReceita }))
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()

    expect(await screen.findByText(CV.resultadoSucesso)).toBeInTheDocument()
    // O nome da Receita é o ÚNICO <h1>.
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Feijão tropeiro')
    // "Ver e publicar receita" leva ao detalhe (#59) — não re-gera.
    expect(screen.getByRole('link', { name: CV.verReceita })).toHaveAttribute('href', '/recipes/r-1')
    // Sanidade: dois POSTs de stream (turno + destilar); a destilação reusa o mesmo endpoint.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/conversations/stream'))).toHaveLength(2)
  })

  it('CD4 — cap 429 (limite_geracao) no stream: mensagem amigável, sem GET de Receita (cap intacto)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockConversaFetch({
      stream: { status: 429, body: { error: 'limite_geracao' } },
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
    })
    render(<Harness conversaHint />)

    await enviar(user, 'algo')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroLimiteGeracao)
    // 429 barra ANTES da IA → nunca toca o GET da Receita (não consumiu cap).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('CD5 — QUEDA (stream fecha sem terminal): aviso DISTINTO + Retomar', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockConversaFetch({ stream: ctrl, createSession: { status: 201, body: { sessionId: 'sess-1' } } })
    render(<Harness conversaHint />)

    await enviar(user, 'algo')
    ctrl.push({ type: 'token', text: 'Comece' })
    await screen.findByText('Comece')
    ctrl.close() // sem frame terminal → queda

    expect(await screen.findByText(CV.quedaTitulo)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CV.retomar })).toBeInTheDocument()
    expect(screen.queryByText(CV.erroGeracao)).toBeNull()
  })

  it('CD6 — ESC DURANTE o stream NÃO fecha o drawer (aberto e bloqueante); resolve no mesmo drawer', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockConversaFetch({
      stream: ctrl,
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView({ id: 'r-1', origin: 'ai_chat' }) },
    })
    render(<Harness conversaHint />)

    await enviar(user, 'algo')
    // Em voo (streaming): o input fica travado (fieldset disabled).
    await waitFor(() => expect(screen.getByLabelText(CV.inputLabel)).toBeDisabled())

    // ESC com o stream in-flight: o dismiss é bloqueado.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Resolve dentro do mesmo drawer.
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    expect(await screen.findByText(CV.resultadoSucesso)).toBeInTheDocument()
  })

  it('CD7 — en-US: rótulos do chat seguem o locale (paridade i18n, ADR-0001)', () => {
    render(<Harness locale="en-US" conversaHint />)
    expect(drawer()).toHaveAccessibleName(enUS.criarDrawer.tituloConversa)
    expect(screen.getByLabelText(enUS.conversa.inputLabel)).toBeInTheDocument()
    expect(screen.getByText(enUS.criarDrawer.conversaIntro)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de COMPONENTE jsdom do modo CONVERSA (#60/#104) — o seam de frontend acima do servidor
 * (sem browser/Postgres). Renderiza `ConversaFocusedView` (a VISTA FOCADA do Modo Conversa, que
 * vive em `/create` desde #104 S7), NÃO mais o monólito `conversation-experience.tsx` (deletado).
 *
 * A vista é FOCADA, não um log: só o ÚLTIMO par de falas (Usuário + resposta da IA) aparece
 * inline; o histórico COMPLETO fica atrás de "Ver transcrição" (modal read-only). As asserções
 * que antes verificavam "todo o histórico visível inline" foram re-alvadas a essa realidade.
 *
 * A novidade vs. create-structured.test.tsx: o transporte é NDJSON em STREAMING. O mock de
 * `fetch` discrimina por URL e devolve, para `/api/conversations/stream`, uma Response-like cujo
 * `body` é um ReadableStream REAL que emite chunks `TextEncoder().encode(JSON.stringify(frame) +
 * '\n')`. Os chunks são liberados UM A UM entre asserts (anti-vácuo) → o teste PROVA que os
 * tokens aparecem INCREMENTALMENTE (texto parcial visível ANTES do frame terminal), não só no
 * estado final.
 *
 * Demais stubs: `POST /api/creation-sessions` → {sessionId}; `GET /api/recipes/{id}?locale=` →
 * RecipeView CRU (2º GET); `GET /api/creation-sessions/{id}` → retomada; `DELETE
 * .../transcript` → apagar. `next/link` e `@/lib/auth-client` mockados (sem AppRouter/Better
 * Auth no jsdom).
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
import { WithCozinhaVocab } from '../helpers/cozinha-vocab'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { ConversaFocusedView } from '@/components/recipe/conversa-focused-view'

const M = ptBR.conversa

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function renderConversation(locale: Locale = 'pt-BR', resumeSessionId?: string) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <WithCozinhaVocab>
        <ConversaFocusedView resumeSessionId={resumeSessionId} />
      </WithCozinhaVocab>
    </LocaleProvider>,
  )
}

function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Feijão tropeiro',
    origin: 'ai_chat',
    schemaVersion: 1,
    body: { descricao: 'Um prato mineiro.', passos: ['Refogue', 'Misture'], notas: null },
    facets: { cozinha: 'mineira', categoria: 'prato_principal', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    // rawText = linha humana COMPLETA (inclui a medida), como toda origem grava; exibida verbatim.
    ingredients: [{ ordem: 1, quantidade: '2.000', unidade: 'xicara', rawText: '2 xícaras de feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

type Frame =
  | { type: 'token'; text: string }
  | {
      type: 'recipe'
      outcome: 'success' | 'degraded' | 'playful'
      recipeId: string | null
      advisory: string | null
      avisos?: unknown[]
    }
  | { type: 'impossible'; advisory: string | null }
  | { type: 'error'; error: 'geracao_invalida' | 'conflito_concorrente' }

/**
 * Controlador de stream NDJSON: cada `push(frame)` enfileira uma linha; `close()` fecha SEM
 * mais frames (queda quando nenhum terminal foi empurrado). O ReadableStream lê de uma fila
 * com uma promise-gate, então o teste libera chunks UM A UM e pode assertar entre eles.
 */
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
      // Espera até haver chunk OU fechamento.
      while (queue.length === 0 && !closed) {
        await new Promise<void>((res) => (wake = res))
      }
      if (queue.length > 0) {
        controller.enqueue(queue.shift()!)
        return
      }
      controller.close()
    },
  })
  return {
    stream,
    push(frame: Frame) {
      queue.push(encoder.encode(JSON.stringify(frame) + '\n'))
      bump()
    },
    /** Empurra texto bruto (ex.: meio-frame) para exercitar o buffer de tail parcial. */
    pushRaw(raw: string) {
      queue.push(encoder.encode(raw))
      bump()
    },
    close() {
      closed = true
      bump()
    },
  }
}

type StreamResult = ReturnType<typeof makeStreamController>
type JsonResult = { status: number; body: unknown } | { reject: true }

/**
 * Mocka `fetch` por URL. `stream` recebe o controlador (ou uma factory async que pendura a
 * abertura do POST do stream — anti-vácuo). Os demais endpoints devolvem JSON simples.
 */
function mockFetch(opts: {
  stream?: StreamResult | (() => Promise<StreamResult>) | JsonResult
  createSession?: JsonResult
  recipes?: JsonResult
  resume?: JsonResult
  del?: JsonResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/api/conversations/stream')) {
      const s = typeof opts.stream === 'function' ? await opts.stream() : opts.stream
      if (s && 'reject' in s) throw new TypeError('network down')
      if (s && 'status' in s) {
        // Falha pré-stream (ex.: 401/400): Response sem body de stream.
        return { ok: s.status >= 200 && s.status < 300, status: s.status, body: null } as unknown as Response
      }
      const ctrl = s as StreamResult
      return { ok: true, status: 200, body: ctrl.stream } as unknown as Response
    }
    if (url.includes('/api/creation-sessions/') && url.includes('/transcript') && method === 'DELETE') {
      const r = opts.del ?? { status: 200, body: { ok: true } }
      if ('reject' in r) throw new TypeError('network down')
      return makeJson(r)
    }
    if (url.includes('/api/creation-sessions/') && method === 'GET') {
      const r = opts.resume ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeJson(r)
    }
    if (url.includes('/api/creation-sessions') && method === 'POST') {
      const r = opts.createSession ?? { status: 201, body: { sessionId: 'sess-1' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeJson(r)
    }
    if (url.includes('/api/recipes/')) {
      const r = opts.recipes ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeJson(r)
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function makeJson(r: { status: number; body: unknown }) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  } as Response
}

/** Digita uma mensagem no input do chat e clica em Enviar. */
async function enviar(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText(M.inputLabel), text)
  await user.click(screen.getByRole('button', { name: M.enviar }))
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ConversaFocusedView (#60/#104)', () => {
  it('C1 — visitante anônimo vê o convite para entrar, não o chat', () => {
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    renderConversation()

    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    // Sem input do chat e exatamente UM heading nível 1 (conversa.titulo).
    expect(screen.queryByLabelText(M.inputLabel)).toBeNull()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(M.titulo)
  })

  it('C2 — multi-turno: tokens INCREMENTAIS visíveis ANTES do terminal → Receita pronta para salvar', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({
      stream: ctrl,
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView() },
    })
    renderConversation()

    await enviar(user, 'quero um feijão tropeiro')

    // A fala do Usuário aparece imediatamente.
    expect(await screen.findByText('quero um feijão tropeiro')).toBeInTheDocument()

    // ── PROVA DE INCREMENTALIDADE: libera tokens um a um e assere o parcial ANTES do terminal.
    ctrl.push({ type: 'token', text: 'Vamos ' })
    expect(await screen.findByText('Vamos')).toBeInTheDocument()
    // Terminal AINDA não chegou: nenhuma Receita renderizada.
    expect(screen.queryByText(M.resultadoSucesso)).toBeNull()

    ctrl.push({ type: 'token', text: 'fazer feijão.' })
    expect(await screen.findByText('Vamos fazer feijão.')).toBeInTheDocument()
    expect(screen.queryByText(M.resultadoSucesso)).toBeNull()

    // Terminal recipe → 2º GET → Receita renderizada (pronta para salvar).
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()

    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    // Corpo lido CRU pelo 2º GET (trava ausência de wrapper): a LINHA de ingrediente (rawText verbatim).
    expect(screen.getByText('2 xícaras de feijão')).toBeInTheDocument()

    // Exatamente UM heading nível 1: o nome da Receita (conversa.titulo virou <h2>).
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(baseView().name)

    // POST /api/creation-sessions chamado no 1º turno; sessionId segurado no body do stream.
    expect(fetchMock.mock.calls.some((c) => {
      const i = c[1] as RequestInit | undefined
      return String(c[0]).includes('/api/creation-sessions') && (i?.method ?? '') === 'POST'
    })).toBe(true)
    const streamCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/conversations/stream'))!
    const sent = JSON.parse((streamCall[1] as RequestInit).body as string)
    expect(sent.sessionId).toBe('sess-1')
    expect(sent.transcript[sent.transcript.length - 1]).toEqual({ role: 'user', content: 'quero um feijão tropeiro' })

    // 2º GET com /api/recipes/r-1 e locale=pt-BR.
    const getCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/recipes/'))!
    expect(String(getCall[0])).toContain('/api/recipes/r-1')
    expect(String(getCall[0])).toContain('locale=pt-BR')
  })

  it('C3 — multi-turno de verdade: 2º turno reenvia o transcript INTEIRO + sessionId', async () => {
    const user = userEvent.setup()
    let ctrl = makeStreamController()
    const fetchMock = mockFetch({
      stream: () => Promise.resolve(ctrl),
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView() },
    })
    renderConversation()

    await enviar(user, 'oi')
    ctrl.push({ type: 'token', text: 'Olá!' })
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await screen.findByText(M.resultadoSucesso)

    // 2º turno: novo controlador de stream.
    ctrl = makeStreamController()
    await enviar(user, 'mais picante')
    ctrl.push({ type: 'token', text: 'Beleza.' })
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await screen.findByText(M.resultadoSucesso)

    // O 2º POST do stream carrega o transcript COM as 4 falas (user/assistant x2) + sessionId.
    const streamCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/conversations/stream'))
    expect(streamCalls).toHaveLength(2)
    const second = JSON.parse((streamCalls[1][1] as RequestInit).body as string)
    expect(second.sessionId).toBe('sess-1')
    expect(second.transcript).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá!' },
      { role: 'user', content: 'mais picante' },
    ])
    // createSession chamado SÓ uma vez (id segurado entre turnos).
    const created = fetchMock.mock.calls.filter((c) => {
      const i = c[1] as RequestInit | undefined
      return String(c[0]).includes('/api/creation-sessions') && (i?.method ?? '') === 'POST'
    })
    expect(created).toHaveLength(1)
  })

  it('C4 — DEGRADED: mensagem de limitação + advisory + Receita', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView({ id: 'r-2' }) } })
    renderConversation()

    await enviar(user, 'algo')
    ctrl.push({ type: 'recipe', outcome: 'degraded', recipeId: 'r-2', advisory: 'Troquei manteiga por azeite.' })
    ctrl.close()

    expect(await screen.findByText(M.resultadoDegradado)).toBeInTheDocument()
    expect(screen.getByText(/Troquei manteiga por azeite\./)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('C5 — PLAYFUL: brincadeira não-publicável, NEUTRA (sem âmbar/note)', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView({ id: 'r-3' }) } })
    renderConversation()

    await enviar(user, 'me faz rir')
    ctrl.push({ type: 'recipe', outcome: 'playful', recipeId: 'r-3', advisory: null })
    ctrl.close()

    expect(await screen.findByText(M.playfulTitulo)).toBeInTheDocument()
    expect(screen.getByText(M.playfulNota)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    // Cartão playful é NEUTRO — sem role="note" (âmbar é exclusivo do Aviso).
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('C6 — IMPOSSIBLE: mensagem clara sem Receita; NUNCA faz GET de Receita', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({ stream: ctrl })
    renderConversation()

    await enviar(user, 'uma receita de tijolos')
    ctrl.push({ type: 'impossible', advisory: 'Isso não é comida.' })
    ctrl.close()

    expect(await screen.findByText(M.resultadoImpossivel)).toBeInTheDocument()
    expect(screen.getByText(/Isso não é comida\./)).toBeInTheDocument()
    // Sem Receita: na vista FOCADA o titulo é o <h2> e NÃO há <h1> (o <h1> só entra com o nome
    // da Receita, que aqui não existe — impossível).
    expect(screen.getByRole('heading', { level: 2, name: M.titulo })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('C7 — frame de ERRO (geracao_invalida): erro de sistema neutro + CTA re-destilar; NUNCA Receita parcial', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({ stream: ctrl })
    renderConversation()

    await enviar(user, 'algo')
    ctrl.push({ type: 'token', text: 'pensando...' })
    ctrl.push({ type: 'error', error: 'geracao_invalida' })
    ctrl.close()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroGeracao)
    expect(alert.className).not.toMatch(/aviso/)
    expect(screen.getByRole('button', { name: M.redestilar })).toBeInTheDocument()
    // NUNCA renderizou Receita (sem GET, sem heading de Receita).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
    expect(screen.queryByText(M.resultadoSucesso)).toBeNull()
  })

  it('C8 — re-destilar após erro: reenvia transcript terminando em USER (parseTranscript ok)', async () => {
    const user = userEvent.setup()
    let ctrl = makeStreamController()
    const fetchMock = mockFetch({
      stream: () => Promise.resolve(ctrl),
      recipes: { status: 200, body: baseView() },
    })
    renderConversation()

    await enviar(user, 'feijão')
    ctrl.push({ type: 'token', text: 'parcial' })
    ctrl.push({ type: 'error', error: 'geracao_invalida' })
    ctrl.close()
    await screen.findByRole('button', { name: M.redestilar })

    // Re-destila com um stream novo que conclui em recipe.
    ctrl = makeStreamController()
    await user.click(screen.getByRole('button', { name: M.redestilar }))
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()

    // O POST do re-destilar termina em 'user' (a fala do Assistente do turno falho não foi commitada).
    const streamCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/conversations/stream'))
    const last = JSON.parse((streamCalls[streamCalls.length - 1][1] as RequestInit).body as string)
    expect(last.transcript[last.transcript.length - 1].role).toBe('user')
  })

  it('C9 — frame conflito_concorrente: mensagem de "tente de novo" distinta', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl })
    renderConversation()

    await enviar(user, 'algo')
    ctrl.push({ type: 'error', error: 'conflito_concorrente' })
    ctrl.close()

    expect(await screen.findByText(M.erroConflito)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.redestilar })).toBeInTheDocument()
  })

  it('C10 — QUEDA (stream fecha SEM terminal): aviso DISTINTO + CTA retomar', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl })
    renderConversation()

    await enviar(user, 'algo')
    ctrl.push({ type: 'token', text: 'Comece' })
    await screen.findByText('Comece')
    // Fecha SEM frame terminal → queda.
    ctrl.close()

    expect(await screen.findByText(M.quedaTitulo)).toBeInTheDocument()
    expect(screen.getByText(M.quedaNota)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.retomar })).toBeInTheDocument()
    // É DISTINTO do erro de geração: a copy de erro de sistema NÃO aparece.
    expect(screen.queryByText(M.erroGeracao)).toBeNull()
  })

  it('C11 — Aviso de restrição (avisos no terminal) renderiza em âmbar, role=note, não-bloqueante', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({
      stream: ctrl,
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
    renderConversation()

    await enviar(user, 'pão sem glúten com trigo')
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-4', advisory: null })
    ctrl.close()

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Marcada como sem glúten, mas contém trigo — declarado, não verificado.')
    expect(note).toHaveClass('bg-aviso-bg')
    // Não-bloqueante: a Receita continua renderizada.
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
  })

  it('C12 — Receita destilada mas 2º GET falha: "criada mas não carregou" (NÃO impossível)', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { reject: true } })
    renderConversation()

    await enviar(user, 'feijão')
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-9', advisory: null })
    ctrl.close()

    expect(await screen.findByText(M.erroCarregarReceita)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.tentarCarregarNovamente })).toBeInTheDocument()
    // NÃO "impossível" (que induziria reenvio → geração duplicada).
    expect(screen.queryByText(M.resultadoImpossivel)).toBeNull()
  })

  it('C13 — salvar REUSA #59: link "Ver e publicar receita" aponta pro detalhe (NÃO re-gera)', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView({ id: 'r-1' }) } })
    renderConversation()

    await enviar(user, 'feijão')
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await screen.findByText(M.resultadoSucesso)

    // Salvar/publicar é um LINK que NAVEGA pro detalhe (#59), onde moram os controles de
    // Visibilidade — NÃO um botão que re-gera. Apenas UM POST de stream em todo o fluxo.
    const link = screen.getByRole('link', { name: M.verReceita })
    // #231 (ADR-0020): a destilação não devolve slug ⇒ fallback canônico locale-no-caminho
    // `/{locale}/recipes/<uuid>` (pt-BR), que 308a pro slug. Nunca o link nu sem locale.
    expect(link).toHaveAttribute('href', '/pt-BR/recipes/r-1')
    const streamPosts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/conversations/stream'))
    expect(streamPosts).toHaveLength(1)
  })

  it('C14 — RETOMADA: GET /api/creation-sessions/[id] reidrata transcript + Receita', async () => {
    mockFetch({
      resume: {
        status: 200,
        body: {
          session: { id: 'sess-x', mode: 'conversation', recipeId: 'r-1' },
          recipe: baseView({ id: 'r-1' }),
          transcript: [
            { role: 'user', content: 'oi de novo', seq: 0 },
            { role: 'assistant', content: 'oi! bem-vinda de volta', seq: 1 },
          ],
          advisory: null,
        },
      },
    })
    renderConversation('pt-BR', 'sess-x')

    // Transcrição prévia reidratada. Na vista FOCADA só o ÚLTIMO par de falas aparece inline —
    // aqui o transcript reidratado JÁ É esse par (user + assistant), então ambos ficam visíveis.
    expect(await screen.findByText('oi de novo')).toBeInTheDocument()
    expect(screen.getByText('oi! bem-vinda de volta')).toBeInTheDocument()
    // Receita atual reidratada (heading pelo nome) — um único <h1>.
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // Salvar reusa #59 mesmo na retomada. #231: fallback canônico locale-no-caminho (pt-BR), nunca nu.
    expect(screen.getByRole('link', { name: M.verReceita })).toHaveAttribute('href', '/pt-BR/recipes/r-1')
  })

  it('C15 — APAGAR transcript: confirma → DELETE chamado → transcript some, Receita+link ficam', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      resume: {
        status: 200,
        body: {
          session: { id: 'sess-x', mode: 'conversation', recipeId: 'r-1' },
          recipe: baseView({ id: 'r-1' }),
          transcript: [{ role: 'user', content: 'apaga isso', seq: 0 }],
          advisory: null,
        },
      },
      del: { status: 200, body: { ok: true } },
    })
    renderConversation('pt-BR', 'sess-x')

    await screen.findByText('apaga isso')

    // Abre o diálogo de confirmação (avisa irreversibilidade).
    await user.click(screen.getByRole('button', { name: M.apagarTranscricao }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.apagarAviso)).toBeInTheDocument()

    // Confirma → DELETE .../transcript.
    await user.click(within(dialog).getByRole('button', { name: M.apagarConfirmar }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => {
        const i = c[1] as RequestInit | undefined
        return String(c[0]).includes('/api/creation-sessions/sess-x/transcript') && (i?.method ?? '') === 'DELETE'
      })).toBe(true)
    })

    // Transcrição apagada localmente; a Receita + o link de salvar PERMANECEM.
    await waitFor(() => expect(screen.queryByText('apaga isso')).toBeNull())
    expect(screen.getByRole('heading', { name: baseView().name })).toBeInTheDocument()
    // #231: fallback canônico locale-no-caminho (pt-BR), nunca o link nu.
    expect(screen.getByRole('link', { name: M.verReceita })).toHaveAttribute('href', '/pt-BR/recipes/r-1')
  })

  it('C16 — buffer de tail parcial: um frame partido em DOIS chunks é remontado', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView() } })
    renderConversation()

    await enviar(user, 'feijão')
    // Empurra metade de uma linha JSON (sem '\n'), depois o resto — exige o buffer de tail.
    ctrl.pushRaw('{"type":"token","text":"meio-')
    ctrl.pushRaw('frame"}\n')
    expect(await screen.findByText('meio-frame')).toBeInTheDocument()

    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
  })

  it('C17 — en-US: rótulos do chat seguem o locale', () => {
    renderConversation('en-US')
    expect(screen.getByRole('button', { name: enUS.conversa.enviar })).toBeInTheDocument()
    expect(screen.getByLabelText(enUS.conversa.inputLabel)).toBeInTheDocument()
    // A vista FOCADA não tem o texto de "conversa vazia" do log antigo; a descrição localizada
    // ancora o locale sem conversa iniciada.
    expect(screen.getByText(enUS.conversa.descricao)).toBeInTheDocument()
    // Na vista focada autenticada SEM Receita, `titulo` é um <h2> (cede o <h1> para o nome da
    // Receita quando ela entra); nenhum <h1> existe ainda.
    expect(screen.getByRole('heading', { level: 2, name: enUS.conversa.titulo })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('C18 — RETOMADA falhou (GET 404): mensagem clara + saída pra nova conversa, sem crash', async () => {
    // 404 (Session inexistente/expirada ou de outro dono) → não um chat vazio quebrado.
    mockFetch({ resume: { status: 404, body: { error: 'not_found' } } })
    renderConversation('pt-BR', 'sess-inexistente')

    expect(await screen.findByText(M.retomarFalhou)).toBeInTheDocument()
    // Caminho de saída para uma conversa NOVA: a entrada limpa do Modo Conversa agora é a tela
    // CRIAR unificada (#104 S7) — `/create?mode=conversa`, NÃO o antigo `/conversation`.
    expect(screen.getByRole('link', { name: M.novaConversa })).toHaveAttribute(
      'href',
      '/create?mode=conversa',
    )
    // Não renderizou o chat (sem input) e não quebrou (heading nível 1 presente).
    expect(screen.queryByLabelText(M.inputLabel)).toBeNull()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(M.titulo)
  })

  it('C19 — "Nova conversa" zera transcript, sessionId, input e volta ao estado inicial', async () => {
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({
      stream: ctrl,
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView() },
    })
    renderConversation()

    await enviar(user, 'feijão')
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await screen.findByText(M.resultadoSucesso)
    // Há conversa + Receita: o botão "Nova conversa" aparece.

    await user.click(screen.getByRole('button', { name: M.novaConversa }))

    // Volta ao estado inicial: transcript vazio, sem Receita, input limpo. A vista FOCADA não
    // tem o texto "conversa vazia" do log antigo — provamos o reset pela AUSÊNCIA do último par
    // de falas e da Receita, e pelo input zerado.
    await waitFor(() => expect(screen.queryByText('feijão')).toBeNull())
    expect(screen.queryByText(M.resultadoSucesso)).toBeNull()
    expect(screen.getByLabelText(M.inputLabel)).toHaveValue('')
    // Sem Receita na tela: titulo é o <h2> e não há nenhum <h1>.
    expect(screen.getByRole('heading', { level: 2, name: M.titulo })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    // "Ver transcrição" some quando não há mais conversa (transcript zerado).
    expect(screen.queryByRole('button', { name: M.verTranscricao })).toBeNull()

    // Próximo turno cria uma Session NOVA (sessionId foi zerado) → 2º POST de createSession.
    const ctrl2 = makeStreamController()
    fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      const init = args[1] as RequestInit | undefined
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/conversations/stream')) {
        return { ok: true, status: 200, body: ctrl2.stream } as unknown as Response
      }
      if (url.includes('/api/creation-sessions') && method === 'POST') {
        return makeJson({ status: 201, body: { sessionId: 'sess-2' } })
      }
      if (url.includes('/api/recipes/')) return makeJson({ status: 200, body: baseView() })
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    await enviar(user, 'de novo')
    ctrl2.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl2.close()
    await screen.findByText(M.resultadoSucesso)
    const created = fetchMock.mock.calls.filter((c) => {
      const i = c[1] as RequestInit | undefined
      return String(c[0]).includes('/api/creation-sessions') && (i?.method ?? '') === 'POST'
    })
    // 1 createSession antes do reset + 1 depois (id foi zerado) = 2.
    expect(created.length).toBe(2)
  })

  it('C20 — APAGAR falha (DELETE não-ok): erro mostrado e a transcrição PERMANECE', async () => {
    const user = userEvent.setup()
    mockFetch({
      resume: {
        status: 200,
        body: {
          session: { id: 'sess-x', mode: 'conversation', recipeId: 'r-1' },
          recipe: baseView({ id: 'r-1' }),
          transcript: [{ role: 'user', content: 'apaga isso' }],
          advisory: null,
        },
      },
      del: { status: 500, body: { error: 'boom' } },
    })
    renderConversation('pt-BR', 'sess-x')

    await screen.findByText('apaga isso')
    await user.click(screen.getByRole('button', { name: M.apagarTranscricao }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: M.apagarConfirmar }))

    // Erro de apagar mostrado DENTRO do diálogo; o diálogo continua aberto.
    expect(await within(dialog).findByText(M.apagarErro)).toBeInTheDocument()
    // A transcrição PERMANECE (apagar falhou → nada foi zerado).
    expect(screen.getByText('apaga isso')).toBeInTheDocument()
  })

  it('C21 — vista focada após ERRO: transcript termina em USER → só a bolha do Usuário, sem bolha da IA', async () => {
    // Após um frame de erro o turno do Assistente NÃO é commitado: o transcript termina em
    // 'user'. `lastExchange` então devolve { user, assistant: null } e a vista focada mostra
    // SÓ a bolha do Usuário — nenhuma bolha de resposta da IA fica pendurada.
    const user = userEvent.setup()
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl })
    renderConversation()

    await enviar(user, 'meu pedido')
    // Stream emite um token parcial e então um frame de erro (sem terminal recipe).
    ctrl.push({ type: 'token', text: 'rascunho parcial' })
    await screen.findByText('rascunho parcial')
    ctrl.push({ type: 'error', error: 'geracao_invalida' })
    ctrl.close()

    // O frame de erro chegou: a bolha viva foi descartada (turno do Assistente não commitado).
    await screen.findByRole('alert')
    // A bolha do Usuário do último par permanece visível…
    expect(screen.getByText('meu pedido')).toBeInTheDocument()
    // …e NÃO há bolha de resposta da IA: nem o texto parcial, nem o rótulo da resposta da IA.
    expect(screen.queryByText('rascunho parcial')).toBeNull()
    expect(screen.queryByText(M.respostaIA)).toBeNull()
  })

  it('C22 — "Ver transcrição" mostra o histórico COMPLETO multi-turno embora só o último par esteja inline', async () => {
    const user = userEvent.setup()
    let ctrl = makeStreamController()
    const fetchMock = mockFetch({
      stream: () => Promise.resolve(ctrl),
      createSession: { status: 201, body: { sessionId: 'sess-1' } },
      recipes: { status: 200, body: baseView() },
    })
    renderConversation()

    // Turno 1: pergunta A → resposta A.
    await enviar(user, 'pergunta A')
    ctrl.push({ type: 'token', text: 'resposta A' })
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await screen.findByText(M.resultadoSucesso)

    // Turno 2: pergunta B → resposta B. O par 1 é SOBRESCRITO inline (vista focada).
    ctrl = makeStreamController()
    await enviar(user, 'pergunta B')
    ctrl.push({ type: 'token', text: 'resposta B' })
    ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl.close()
    await waitFor(() => expect(screen.getAllByText(M.resultadoSucesso).length).toBeGreaterThan(0))

    // INLINE: só o último par (B). O par 1 (A) NÃO está mais inline.
    expect(screen.queryByText('pergunta A')).toBeNull()
    expect(screen.queryByText('resposta A')).toBeNull()
    expect(screen.getByText('pergunta B')).toBeInTheDocument()
    expect(screen.getByText('resposta B')).toBeInTheDocument()

    // "Ver transcrição" abre o modal read-only com o histórico COMPLETO (os DOIS turnos).
    await user.click(screen.getByRole('button', { name: M.verTranscricao }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.transcricaoTitulo)).toBeInTheDocument()
    expect(within(dialog).getByText('pergunta A')).toBeInTheDocument()
    expect(within(dialog).getByText('resposta A')).toBeInTheDocument()
    expect(within(dialog).getByText('pergunta B')).toBeInTheDocument()
    expect(within(dialog).getByText('resposta B')).toBeInTheDocument()
    // Sanidade: o stream foi exercido nos dois turnos.
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/conversations/stream')),
    ).toHaveLength(2)
  })
})

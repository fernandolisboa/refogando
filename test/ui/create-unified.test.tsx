import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de COMPONENTE jsdom da tela CRIAR UNIFICADA (#104) — o toggle externo Formulário ↔
 * Conversa sobre `CreatePageClient`. Cobre: o modo Formulário renderiza a UI estruturada (#58);
 * alternar para Conversa mostra a VISTA FOCADA; o guard de Visitante esconde o input; `?mode=
 * conversa` semeia o modo inicial; o placeholder ROTATIVO cicla só com input vazio/ocioso e
 * PARA no unmount; só o último par de falas aparece inline e "Ver transcrição" abre o modal com
 * o histórico completo.
 *
 * Mocks (sem AppRouter/Better Auth/Postgres no jsdom): `next/link` → <a>; `@/lib/auth-client`
 * useSession → estado mutável; `next/navigation` useSearchParams → `URLSearchParams` por teste.
 * O transporte do chat é NDJSON em streaming (mesmo controlador do conversation.test.tsx).
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

// Search params mutável por teste (o repo passa a usar useSearchParams a partir desta tela).
let searchParams: URLSearchParams
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import { CreatePageClient } from '@/components/recipe/create-page-client'

const C = ptBR.criar
const V = ptBR.conversa

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
      <CreatePageClient />
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
    ingredients: [{ ordem: 1, quantidade: '2.000', unidade: 'xicara', rawText: 'feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

// ── Controlador de stream NDJSON (espelha conversation.test.tsx) ──────────────
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
    close() {
      closed = true
      bump()
    },
  }
}

type StreamResult = ReturnType<typeof makeStreamController>
type JsonResult = { status: number; body: unknown }

function makeJson(r: JsonResult) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  } as Response
}

function mockFetch(opts: {
  stream?: StreamResult
  createSession?: JsonResult
  recipes?: JsonResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/api/conversations/stream')) {
      const ctrl = opts.stream as StreamResult
      return { ok: true, status: 200, body: ctrl.stream } as unknown as Response
    }
    if (url.includes('/api/creation-sessions') && method === 'POST') {
      return makeJson(opts.createSession ?? { status: 201, body: { sessionId: 'sess-1' } })
    }
    if (url.includes('/api/recipes/')) {
      return makeJson(opts.recipes ?? { status: 404, body: { error: 'not_found' } })
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

async function enviar(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText(V.inputLabel), text)
  await user.click(screen.getByRole('button', { name: V.enviar }))
}

beforeEach(() => {
  sessionState = authed()
  searchParams = new URLSearchParams()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Tela CRIAR unificada (#104)', () => {
  it('T1 — modo Formulário (default) renderiza a UI estruturada', () => {
    renderCreate()

    // O toggle externo existe e Formulário está ativo.
    const toggle = screen.getByRole('radiogroup', { name: C.seletorModo })
    expect(within(toggle).getByRole('radio', { name: C.modoFormulario })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // A UI estruturada (#58): o seu próprio toggle interno + o botão Gerar receita.
    expect(screen.getByRole('radiogroup', { name: C.modoLegenda })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: C.gerar })).toBeInTheDocument()
    // O chat NÃO está montado no modo Formulário.
    expect(screen.queryByLabelText(V.inputLabel)).toBeNull()
  })

  it('T2 — alternar para Conversa renderiza a vista focada (com input de chat)', async () => {
    const user = userEvent.setup()
    renderCreate()

    await user.click(screen.getByRole('radio', { name: C.modoConversa }))

    // A vista focada do chat: o input de mensagem aparece; a UI estruturada some.
    expect(screen.getByLabelText(V.inputLabel)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: C.gerar })).toBeNull()
    const toggle = screen.getByRole('radiogroup', { name: C.seletorModo })
    expect(within(toggle).getByRole('radio', { name: C.modoConversa })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('T3 — Visitante anônimo no modo Conversa vê CTA para /sign-in e NENHUM input', async () => {
    const user = userEvent.setup()
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    renderCreate()

    await user.click(screen.getByRole('radio', { name: C.modoConversa }))

    expect(screen.getByText(V.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByLabelText(V.inputLabel)).toBeNull()
  })

  it('T4 — ?mode=conversa semeia o modo Conversa no primeiro render', () => {
    searchParams = new URLSearchParams('mode=conversa')
    renderCreate()

    expect(screen.getByLabelText(V.inputLabel)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: C.gerar })).toBeNull()
    const toggle = screen.getByRole('radiogroup', { name: C.seletorModo })
    expect(within(toggle).getByRole('radio', { name: C.modoConversa })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('T5 — placeholder rotativo cicla (fake timers) e PARA após unmount', () => {
    vi.useFakeTimers()
    searchParams = new URLSearchParams('mode=conversa')
    const { unmount } = renderCreate()

    const input = screen.getByLabelText(V.inputLabel) as HTMLTextAreaElement
    const first = input.placeholder
    expect(V.placeholders).toContain(first)

    // Avança o intervalo: o placeholder troca para o próximo da lista (input vazio + idle). O
    // `act` deixa o React aplicar o setState do timer antes de lermos o placeholder.
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    const second = (screen.getByLabelText(V.inputLabel) as HTMLTextAreaElement).placeholder
    expect(second).not.toBe(first)
    expect(V.placeholders).toContain(second)

    // Após desmontar, o intervalo foi limpo: avançar o tempo não dispara mais callbacks (sem
    // setState em componente desmontado). `getTimerCount() === 0` prova o clearInterval.
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('T6 — só o último par de falas aparece inline; "Ver transcrição" abre o modal com TODO o histórico', async () => {
    const user = userEvent.setup()
    searchParams = new URLSearchParams('mode=conversa')

    // Turno 1: pergunta A → resposta A.
    const ctrl1 = makeStreamController()
    mockFetch({ stream: ctrl1, recipes: { status: 200, body: baseView() } })
    renderCreate()

    await enviar(user, 'pergunta A')
    expect(await screen.findByText('pergunta A')).toBeInTheDocument()
    ctrl1.push({ type: 'token', text: 'resposta A' })
    expect(await screen.findByText('resposta A')).toBeInTheDocument()
    ctrl1.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl1.close()
    expect(await screen.findByText(V.resultadoSucesso)).toBeInTheDocument()

    // Turno 2: pergunta B → resposta B. O par anterior é SOBRESCRITO na vista focada.
    const ctrl2 = makeStreamController()
    mockFetch({ stream: ctrl2, recipes: { status: 200, body: baseView() } })
    await enviar(user, 'pergunta B')
    expect(await screen.findByText('pergunta B')).toBeInTheDocument()
    ctrl2.push({ type: 'token', text: 'resposta B' })
    expect(await screen.findByText('resposta B')).toBeInTheDocument()
    ctrl2.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
    ctrl2.close()
    await waitFor(() => expect(screen.getAllByText(V.resultadoSucesso).length).toBeGreaterThan(0))

    // VISTA FOCADA: o par 1 NÃO está mais inline (sobrescrito pelo último).
    expect(screen.queryByText('pergunta A')).toBeNull()
    expect(screen.queryByText('resposta A')).toBeNull()
    expect(screen.getByText('pergunta B')).toBeInTheDocument()
    expect(screen.getByText('resposta B')).toBeInTheDocument()

    // "Ver transcrição" abre o modal com o histórico COMPLETO (os dois turnos).
    await user.click(screen.getByRole('button', { name: V.verTranscricao }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('pergunta A')).toBeInTheDocument()
    expect(within(dialog).getByText('resposta A')).toBeInTheDocument()
    expect(within(dialog).getByText('pergunta B')).toBeInTheDocument()
    expect(within(dialog).getByText('resposta B')).toBeInTheDocument()
  })
})

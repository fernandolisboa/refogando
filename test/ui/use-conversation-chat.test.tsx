import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de UNIDADE do cérebro do Modo Conversa (#60/#104 S1): `useConversationChat`, isolado da
 * JSX. Roda no projeto "ui" (jsdom, SEM Postgres) — por isso vive em `test/ui/`. Renderiza o
 * hook com `renderHook` envolto no `LocaleProvider` (de onde o caller resolveria o locale) e
 * mocka `fetch` por URL com `vi.stubGlobal`, devolvendo um ReadableStream NDJSON REAL para o
 * POST do stream. Complementa `conversation.test.tsx` (que cobre a JSX) checando a máquina de
 * estados diretamente: turno normal, frame de erro (NÃO commita o Assistente), reset, e falha
 * do 2º GET (`loadFailed`).
 */
import { LocaleProvider } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'
import { useConversationChat } from '@/hooks/use-conversation-chat'

function wrapper(locale: Locale = 'pt-BR') {
  function Wrapper({ children }: { children: ReactNode }) {
    return <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
  }
  return Wrapper
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

/** Controlador de stream NDJSON (mesma forma do teste de componente): push/close manuais. */
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
type JsonResult = { status: number; body: unknown } | { reject: true }

function makeJson(r: { status: number; body: unknown }) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  } as Response
}

function mockFetch(opts: {
  stream?: StreamResult | (() => Promise<StreamResult>)
  // #167: resposta JSON PRÉ-stream (ex.: 429 limite_geracao) — quando presente, o POST do stream
  // devolve JSON em vez de abrir o ReadableStream (espelha o gate da rota antes do seam).
  streamJson?: { status: number; body: unknown }
  createSession?: JsonResult
  recipes?: JsonResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/api/conversations/stream')) {
      if (opts.streamJson) return makeJson(opts.streamJson)
      const s = typeof opts.stream === 'function' ? await opts.stream() : opts.stream
      const ctrl = s as StreamResult
      return { ok: true, status: 200, body: ctrl.stream } as unknown as Response
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  // jsdom não traz TextEncoder/Decoder em todas as versões; garante presença (no-op se já há).
  // (O projeto "ui" usa jsdom; os globals já existem, mas o guard é barato e explícito.)
})

describe('useConversationChat (#104 S1)', () => {
  it('turno normal: anexa user + assistant ao transcript e expõe a Receita', async () => {
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView() } })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    // Dispara o turno via onSubmit (input controlado + form submit).
    act(() => result.current.setInput('quero feijão'))
    act(() => {
      result.current.onSubmit({
        preventDefault: () => {},
      } as React.FormEvent<HTMLFormElement>)
    })

    // A fala do Usuário entra imediatamente; o status vira streaming.
    await waitFor(() => expect(result.current.transcript).toHaveLength(1))
    expect(result.current.transcript[0]).toEqual({ role: 'user', content: 'quero feijão' })

    // Tokens incrementais acumulam na bolha viva (NÃO no transcript ainda).
    act(() => ctrl.push({ type: 'token', text: 'Vamos ' }))
    act(() => ctrl.push({ type: 'token', text: 'lá.' }))
    await waitFor(() => expect(result.current.liveAssistant).toBe('Vamos lá.'))

    // Terminal recipe → commita o Assistente + carrega a Receita (2º GET).
    act(() => {
      ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
      ctrl.close()
    })

    await waitFor(() => expect(result.current.status).toBe('result'))
    expect(result.current.transcript).toEqual([
      { role: 'user', content: 'quero feijão' },
      { role: 'assistant', content: 'Vamos lá.' },
    ])
    expect(result.current.view?.name).toBe('Feijão tropeiro')
    expect(result.current.result?.outcome).toBe('success')
    expect(result.current.loadFailed).toBe(false)
    expect(result.current.liveAssistant).toBe('')
  })

  it('frame de ERRO terminal: NÃO commita o Assistente; transcript termina em user', async () => {
    const ctrl = makeStreamController()
    const fetchMock = mockFetch({ stream: ctrl })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    act(() => result.current.setInput('algo'))
    act(() => {
      result.current.onSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
    })
    await waitFor(() => expect(result.current.transcript).toHaveLength(1))

    act(() => ctrl.push({ type: 'token', text: 'pensando...' }))
    act(() => {
      ctrl.push({ type: 'error', error: 'geracao_invalida' })
      ctrl.close()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorKey).toBe('geracao_invalida')
    // O Assistente NÃO foi commitado: a última (e única) fala é do Usuário.
    expect(result.current.transcript).toEqual([{ role: 'user', content: 'algo' }])
    expect(result.current.transcript[result.current.transcript.length - 1].role).toBe('user')
    // NUNCA fez o 2º GET de Receita num frame de erro.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('novaConversa: zera transcript, sessionId, view, result e volta ao idle', async () => {
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { status: 200, body: baseView() } })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    act(() => result.current.setInput('feijão'))
    act(() => {
      result.current.onSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
    })
    act(() => {
      ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
      ctrl.close()
    })
    await waitFor(() => expect(result.current.status).toBe('result'))
    expect(result.current.sessionId).toBe('sess-1')
    expect(result.current.view).not.toBeNull()

    act(() => result.current.novaConversa())

    expect(result.current.transcript).toEqual([])
    expect(result.current.sessionId).toBeNull()
    expect(result.current.input).toBe('')
    expect(result.current.view).toBeNull()
    expect(result.current.result).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('429 limite_geracao (#167) PRÉ-stream: status error + errorKey limite_geracao; NÃO commita Assistente, NÃO faz GET', async () => {
    const fetchMock = mockFetch({ streamJson: { status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } } })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    act(() => result.current.setInput('algo'))
    act(() => {
      result.current.onSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    // Desfecho LIMPO de limite (não 'dropped' / queda ambígua): a UI mapeia p/ mensagem amigável.
    expect(result.current.errorKey).toBe('limite_geracao')
    // Só a fala do Usuário; o Assistente não foi commitado (não houve stream).
    expect(result.current.transcript).toEqual([{ role: 'user', content: 'algo' }])
    // NUNCA fez o 2º GET de Receita (não houve destilação).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
  })

  it('queda com texto parcial: transcript termina em user; redestilar re-posta body válido (sem 400)', async () => {
    // #203: na QUEDA (stream fecha SEM terminal) com fala PARCIAL do Assistente acumulada, o
    // transcript LOCAL não pode terminar em 'assistant' — senão o re-POST de `redestilar` viola
    // `parseTranscript` (última fala = user) e o servidor 400a (`ultima_fala_nao_usuario`).
    const drop = makeStreamController()
    const retry = makeStreamController()
    let streamCalls = 0
    const fetchMock = mockFetch({
      stream: async () => (streamCalls++ === 0 ? drop : retry),
      recipes: { status: 200, body: baseView() },
    })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    act(() => result.current.setInput('quero feijão'))
    act(() => {
      result.current.onSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
    })
    await waitFor(() => expect(result.current.transcript).toHaveLength(1))

    // Token parcial acumula na bolha viva; depois o stream CAI sem frame terminal.
    act(() => drop.push({ type: 'token', text: 'rascunho parcial' }))
    await waitFor(() => expect(result.current.liveAssistant).toBe('rascunho parcial'))
    act(() => drop.close())

    await waitFor(() => expect(result.current.status).toBe('dropped'))
    // O transcript NÃO ganhou a fala parcial do Assistente: termina em 'user'.
    expect(result.current.transcript).toEqual([{ role: 'user', content: 'quero feijão' }])
    expect(result.current.transcript[result.current.transcript.length - 1].role).toBe('user')
    // O texto parcial sumiu do estado local (a destilação não concluiu).
    expect(result.current.liveAssistant).toBe('')

    // redestilar() re-posta o transcript ATUAL — cujo body deve terminar em 'user' (sem 400).
    act(() => result.current.redestilar())
    await waitFor(() => expect(result.current.status).toBe('streaming'))

    const streamPost = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('/api/conversations/stream'),
    )
    expect(streamPost).toBeDefined()
    const postedBody = JSON.parse((streamPost![1] as RequestInit).body as string) as {
      transcript: { role: string; content: string }[]
    }
    expect(postedBody.transcript[postedBody.transcript.length - 1].role).toBe('user')

    // O re-POST conclui com sucesso (sem o 400 de `ultima_fala_nao_usuario`).
    act(() => {
      retry.push({ type: 'recipe', outcome: 'success', recipeId: 'r-1', advisory: null })
      retry.close()
    })
    await waitFor(() => expect(result.current.status).toBe('result'))
  })

  it('2º GET da Receita falha: marca loadFailed (NÃO impossible), status result', async () => {
    const ctrl = makeStreamController()
    mockFetch({ stream: ctrl, recipes: { reject: true } })

    const { result } = renderHook(() => useConversationChat({ locale: 'pt-BR' }), {
      wrapper: wrapper(),
    })

    act(() => result.current.setInput('feijão'))
    act(() => {
      result.current.onSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>)
    })
    act(() => {
      ctrl.push({ type: 'recipe', outcome: 'success', recipeId: 'r-9', advisory: null })
      ctrl.close()
    })

    await waitFor(() => expect(result.current.status).toBe('result'))
    expect(result.current.loadFailed).toBe(true)
    expect(result.current.view).toBeNull()
    // É um sucesso "criado mas não carregou" — NÃO impossible (que induziria reenvio).
    expect(result.current.result?.outcome).toBe('success')
  })
})

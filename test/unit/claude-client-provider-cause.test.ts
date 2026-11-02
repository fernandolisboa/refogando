import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type AnthropicT from '@anthropic-ai/sdk'

/**
 * Regra ESTRITA do `cause: 'provider'` (ADR-0055) no `RealClaudeClient`, com o SDK dublado mas as classes de erro
 * REAIS: só o erro que prova "não cobrado" (HTTP de erro com `status` numérico, falha do `fetch` na fase de
 * conexão, chave ausente), sem nenhuma chamada anterior que tenha voltado e sem nenhuma tentativa do SDK que possa
 * ter chegado ao modelo, devolve a reserva de cota. No stream, o mesmo erro antes do 1º evento vira
 * `ClaudeProviderUnavailableError`; depois dele (ou com `status` undefined, o erro SSE), sobe como veio.
 *
 * Com `sdk.real` ligado, o dublê devolve o SDK REAL (com o `fetch` instrumentado que o client passa) e o teste
 * dubla o `fetch` global: é o que prova as novas tentativas internas do SDK (reset no meio + 529 depois).
 */
const { parse, stream, sdk } = vi.hoisted(() => ({ parse: vi.fn(), stream: vi.fn(), sdk: { real: false } }))
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = await importOriginal<{ default: typeof AnthropicT }>()
  class Fake {
    messages = { parse, stream }
    constructor(opts?: ConstructorParameters<typeof AnthropicT>[0]) {
      // Modo real: o construtor devolve o SDK de verdade no lugar do dublê.
      if (sdk.real) return new real.default(opts) as unknown as Fake
    }
  }
  Object.assign(Fake, {
    APIError: real.default.APIError,
    APIConnectionError: real.default.APIConnectionError,
    APIConnectionTimeoutError: real.default.APIConnectionTimeoutError,
  })
  return { ...real, default: Fake }
})

// O setup (test/setup.ts) já carregou o client com o SDK real via deps.ts: recarrega com o dublê.
vi.resetModules()
const { RealClaudeClient, ClaudeProviderUnavailableError, isUnpaidProviderError } = await import('@/server/claude/client')
const { default: Anthropic } = await vi.importActual<{ default: typeof AnthropicT }>('@anthropic-ai/sdk')

const input = { model: 'claude-opus-5-5', systemPrompt: 's', userPrompt: 'u' }
const http = (status: number) => Anthropic.APIError.generate(status, { type: 'error' }, 'falhou', new Headers())
// Como o SDK monta o erro de um evento SSE `error` no meio do stream (core/streaming.js): status undefined.
const sse = () => new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error' } }, undefined, new Headers())
// Como o `fetch` do Node (undici) rejeita: `TypeError: fetch failed` com o erro do socket (e o `code`) em `cause`.
const fetchFailed = (code: string) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(`falha de socket ${code}`), { code }) })
// Como o SDK embrulha a rejeição do `fetch` depois das novas tentativas (client.js: `new APIConnectionError({ cause })`).
const connErr = (code: string) => new Anthropic.APIConnectionError({ cause: fetchFailed(code) })

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-teste')
})

afterEach(() => {
  parse.mockReset()
  stream.mockReset()
  sdk.real = false
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('isUnpaidProviderError', () => {
  it('HTTP de erro e falha na fase de conexão provam "não cobrado"; reset, timeout, abort, parse e SSE não', () => {
    expect(isUnpaidProviderError(http(500))).toBe(true)
    expect(isUnpaidProviderError(http(529))).toBe(true)
    expect(isUnpaidProviderError(http(429))).toBe(true)
    expect(isUnpaidProviderError(http(400))).toBe(true)
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(isUnpaidProviderError(connErr(code))).toBe(true)
    }
    // O SDK embrulha QUALQUER falha do fetch em APIConnectionError, inclusive com o corpo já enviado.
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'ETIMEDOUT']) {
      expect(isUnpaidProviderError(connErr(code))).toBe(false)
    }
    expect(isUnpaidProviderError(new Anthropic.APIConnectionError({ cause: new TypeError('terminated') }))).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.APIConnectionError({ message: 'sem causa' }))).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.APIConnectionTimeoutError())).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.APIUserAbortError())).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.AnthropicError('Failed to parse structured output'))).toBe(false)
    expect(isUnpaidProviderError(sse())).toBe(false)
    expect(isUnpaidProviderError(new Error('qualquer'))).toBe(false)
  })

  it('alguma tentativa que pode ter chegado ao modelo (maybeBilled) derruba qualquer "não cobrado"', () => {
    const billed = { maybeBilled: true, lastRejection: undefined }
    expect(isUnpaidProviderError(http(529), billed)).toBe(false)
    expect(isUnpaidProviderError(connErr('ECONNREFUSED'), billed)).toBe(false)
    // O timeout do SDK nasce sem `cause`: vale a última rejeição do fetch (aqui, o prazo de conectar do undici).
    const lastConnect = { maybeBilled: false, lastRejection: fetchFailed('UND_ERR_CONNECT_TIMEOUT') }
    expect(isUnpaidProviderError(new Anthropic.APIConnectionTimeoutError(), lastConnect)).toBe(true)
  })
})

describe('RealClaudeClient — parse_failed com cause:provider só no erro não pago', () => {
  it('generateRecipe: 5xx/ECONNREFUSED ⇒ cause:provider; ECONNRESET/timeout/abort/parse ⇒ sem cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const err of [http(503), connErr('ECONNREFUSED')]) {
        parse.mockRejectedValueOnce(err)
        await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed', cause: 'provider' })
      }
      for (const err of [
        connErr('ECONNRESET'),
        new Anthropic.APIConnectionTimeoutError(),
        new Anthropic.APIUserAbortError(),
        new Anthropic.AnthropicError('Failed to parse structured output'),
      ]) {
        parse.mockRejectedValueOnce(err)
        await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed' })
      }
    } finally {
      error.mockRestore()
    }
  })

  it('generateRecipe: o REPARO falhou com 5xx depois de uma 1ª chamada que voltou ⇒ sem cause (já pago)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: null }).mockRejectedValueOnce(http(500))
      await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed' })
      expect(parse).toHaveBeenCalledTimes(2)
    } finally {
      error.mockRestore()
    }
  })

  it('generateRecipeVariants: mesma regra no lote', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      parse.mockRejectedValueOnce(http(529))
      await expect(new RealClaudeClient().generateRecipeVariants(input)).resolves.toEqual([
        { kind: 'parse_failed', cause: 'provider' },
      ])
      parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: null }).mockRejectedValueOnce(http(500))
      await expect(new RealClaudeClient().generateRecipeVariants(input)).resolves.toEqual([{ kind: 'parse_failed' }])
    } finally {
      error.mockRestore()
    }
  })
})

describe('RealClaudeClient.streamConversation — ClaudeProviderUnavailableError só antes do 1º evento', () => {
  const transcript = [{ role: 'user' as const, content: 'oi' }]
  async function drain(): Promise<unknown> {
    try {
      for await (const _ of new RealClaudeClient().streamConversation({ model: 'claude-opus-5-5', systemPrompt: 's', transcript })) {
        void _
      }
      return null
    } catch (e) {
      return e
    }
  }

  it('HTTP de erro antes de qualquer evento ⇒ ClaudeProviderUnavailableError (com o erro do SDK em cause)', async () => {
    const original = http(529)
    stream.mockReturnValueOnce(
      (async function* () {
        throw original
      })(),
    )
    const err = await drain()
    expect(err).toBeInstanceOf(ClaudeProviderUnavailableError)
    expect((err as Error).cause).toBe(original)
  })

  it('erro depois do 1º evento (mesmo só thinking) ou erro SSE (status undefined) ⇒ sobe como veio', async () => {
    const afterEvent = http(500)
    stream.mockReturnValueOnce(
      (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } }
        throw afterEvent
      })(),
    )
    expect(await drain()).toBe(afterEvent)

    const sseErr = sse()
    stream.mockReturnValueOnce(
      (async function* () {
        throw sseErr
      })(),
    )
    expect(await drain()).toBe(sseErr)
  })
})

describe('RealClaudeClient — sem chave da Anthropic, nada saiu: a reserva volta', () => {
  it('generateRecipe/generateRecipeVariants ⇒ cause:provider sem tocar o SDK, e o log nomeia o erro', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed', cause: 'provider' })
      await expect(new RealClaudeClient().generateRecipeVariants(input)).resolves.toEqual([
        { kind: 'parse_failed', cause: 'provider' },
      ])
      expect(parse).not.toHaveBeenCalled()
      // O log de sempre (`logSeamError`): o nome do erro diz a causa.
      expect(error.mock.calls[0][0]).toBe('[claude/generateRecipe] falha na chamada (→ parse_failed):')
      expect(error.mock.calls[0][1]).toMatchObject({ name: 'AnthropicKeyMissingError' })
    } finally {
      error.mockRestore()
    }
  })

  it('streamConversation ⇒ ClaudeProviderUnavailableError (com AnthropicKeyMissingError em cause)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    const iter = new RealClaudeClient().streamConversation({
      model: 'claude-opus-5-5',
      systemPrompt: 's',
      transcript: [{ role: 'user', content: 'oi' }],
    })
    const err = await (async () => {
      try {
        for await (const _ of iter) void _
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ClaudeProviderUnavailableError)
    expect(((err as Error).cause as Error).name).toBe('AnthropicKeyMissingError')
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('RealClaudeClient com o SDK REAL — as novas tentativas internas (maxRetries 2) e o fetch instrumentado', () => {
  // 529 com `retry-after-ms: 0`: o SDK tenta de novo sem esperar. Depois de uma falha de conexão ele espera ~0,5 s.
  const overloaded = () =>
    new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), {
      status: 529,
      headers: { 'content-type': 'application/json', 'retry-after-ms': '0' },
    })

  function stubFetch(...attempts: Array<() => Promise<Response>>) {
    const impl = vi.fn(async () => {
      const next = attempts.shift()
      if (!next) throw new Error('tentativa a mais do que o teste previu')
      return next()
    })
    vi.stubGlobal('fetch', impl)
    return impl
  }

  it('1ª tentativa resetada no meio (talvez cobrada) e 529 nas outras ⇒ COBRADO (sem cause)', async () => {
    sdk.real = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fetch = stubFetch(
        () => Promise.reject(fetchFailed('ECONNRESET')),
        async () => overloaded(),
        async () => overloaded(),
      )
      await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed' })
      expect(fetch).toHaveBeenCalledTimes(3)
      // O erro final é o 529 (que sozinho provaria "não cobrado"): quem barra é o fetch instrumentado.
      expect(error.mock.calls[0][1]).toMatchObject({ status: 529 })
    } finally {
      error.mockRestore()
    }
  })

  it('1ª tentativa com conexão recusada e 529 nas outras ⇒ cause:provider (nada chegou ao modelo)', async () => {
    sdk.real = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fetch = stubFetch(
        () => Promise.reject(fetchFailed('ECONNREFUSED')),
        async () => overloaded(),
        async () => overloaded(),
      )
      await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed', cause: 'provider' })
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      error.mockRestore()
    }
  })

  it('stream: reset antes do 1º evento e 529 depois ⇒ o erro sobe como veio (cobrado)', async () => {
    sdk.real = true
    stubFetch(
      () => Promise.reject(fetchFailed('ECONNRESET')),
      async () => overloaded(),
      async () => overloaded(),
    )
    const iter = new RealClaudeClient().streamConversation({
      model: 'claude-opus-5-5',
      systemPrompt: 's',
      transcript: [{ role: 'user', content: 'oi' }],
    })
    const err = await (async () => {
      try {
        for await (const _ of iter) void _
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(Anthropic.APIError)
    expect(err).not.toBeInstanceOf(ClaudeProviderUnavailableError)
    expect((err as InstanceType<typeof Anthropic.APIError>).status).toBe(529)
  })
})

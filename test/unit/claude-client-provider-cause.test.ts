import { afterEach, describe, expect, it, vi } from 'vitest'
import type AnthropicT from '@anthropic-ai/sdk'

/**
 * Regra ESTRITA do `cause: 'provider'` (ADR-0055) no `RealClaudeClient`, com o SDK dublado mas as classes de erro
 * REAIS: só o erro que prova "não cobrado" (HTTP de erro com `status` numérico, ou conexão recusada que não é
 * timeout), sem nenhuma chamada anterior que tenha voltado, devolve a reserva de cota. No stream, o mesmo erro
 * antes do 1º evento vira `ClaudeProviderUnavailableError`; depois dele (ou com `status` undefined, o erro SSE),
 * sobe como veio.
 */
const { parse, stream } = vi.hoisted(() => ({ parse: vi.fn(), stream: vi.fn() }))
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = await importOriginal<{ default: typeof AnthropicT }>()
  const Fake = class {
    messages = { parse, stream }
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

afterEach(() => {
  parse.mockReset()
  stream.mockReset()
})

describe('isUnpaidProviderError', () => {
  it('HTTP de erro e conexão recusada provam "não cobrado"; timeout, abort, parse e SSE não', () => {
    expect(isUnpaidProviderError(http(500))).toBe(true)
    expect(isUnpaidProviderError(http(529))).toBe(true)
    expect(isUnpaidProviderError(http(429))).toBe(true)
    expect(isUnpaidProviderError(http(400))).toBe(true)
    expect(isUnpaidProviderError(new Anthropic.APIConnectionError({ message: 'ECONNREFUSED' }))).toBe(true)
    expect(isUnpaidProviderError(new Anthropic.APIConnectionTimeoutError())).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.APIUserAbortError())).toBe(false)
    expect(isUnpaidProviderError(new Anthropic.AnthropicError('Failed to parse structured output'))).toBe(false)
    expect(isUnpaidProviderError(sse())).toBe(false)
    expect(isUnpaidProviderError(new Error('qualquer'))).toBe(false)
  })
})

describe('RealClaudeClient — parse_failed com cause:provider só no erro não pago', () => {
  it('generateRecipe: 5xx/conexão recusada ⇒ cause:provider; timeout/abort/parse ⇒ sem cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const err of [http(503), new Anthropic.APIConnectionError({ message: 'x' })]) {
        parse.mockRejectedValueOnce(err)
        await expect(new RealClaudeClient().generateRecipe(input)).resolves.toEqual({ kind: 'parse_failed', cause: 'provider' })
      }
      for (const err of [
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

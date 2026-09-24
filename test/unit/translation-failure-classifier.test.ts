import { afterEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  isRowSpecificTranslationFailure,
  RealTranslator,
  UnusableTranslationError,
} from '@/server/translation/translator'
import { TranslationSchema } from '@/domain/translation-prompt'

// Circuit-breaker da re-tradução (#520): só falhas DA LINHA (saída inutilizável) contam para a
// quarentena; erros de infraestrutura/config nunca — senão uma queda quarentenaria o lote inteiro.

describe('isRowSpecificTranslationFailure (#520)', () => {
  it('UnusableTranslationError (recusa/truncamento/parse/infidelidade) ⇒ falha da linha', () => {
    expect(isRowSpecificTranslationFailure(new UnusableTranslationError('tradução truncada (max_tokens)'))).toBe(true)
  })

  it('erro de parse REAL do helper zodOutputFormat (JSON cortado / schema violado) é AnthropicError puro', () => {
    // Prova a premissa do embrulho em RealTranslator: o SDK lança AnthropicError, NÃO APIError.
    const format = zodOutputFormat(TranslationSchema)
    for (const content of ['{"titulo": "Feijo', '{"titulo": 42}']) {
      let caught: unknown
      try {
        format.parse(content)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(Anthropic.AnthropicError)
      expect(caught).not.toBeInstanceOf(Anthropic.APIError)
    }
  })

  it('erro de conexão/timeout do SDK ⇒ infraestrutura', () => {
    expect(isRowSpecificTranslationFailure(new Anthropic.APIConnectionError({ message: 'down' }))).toBe(false)
    expect(isRowSpecificTranslationFailure(new Anthropic.APIConnectionTimeoutError())).toBe(false)
  })

  it('HTTP do SDK (429 / 5xx / 529 / 400 / 401) ⇒ infraestrutura', () => {
    for (const status of [429, 500, 529, 400, 401]) {
      const err = Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers())
      expect(isRowSpecificTranslationFailure(err)).toBe(false)
    }
  })

  it('AnthropicError genérico (ex.: key ausente) e Error desconhecido ⇒ infraestrutura (na dúvida, só degrada)', () => {
    expect(isRowSpecificTranslationFailure(new Anthropic.AnthropicError('missing key'))).toBe(false)
    expect(isRowSpecificTranslationFailure(new Error('???'))).toBe(false)
  })
})

describe('RealTranslator — fronteira de erro do circuit-breaker (#520)', () => {
  const input = {
    sourceLocale: 'pt-BR',
    targetLocale: 'en-US',
    fields: { titulo: 'Feijoada', descricao: null, passos: null, notas: null },
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  async function translateWith(parseImpl: () => unknown): Promise<unknown> {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.spyOn(Anthropic.Messages.prototype, 'parse').mockImplementation(parseImpl as never)
    try {
      await new RealTranslator().translate(input)
    } catch (err) {
      return err
    }
    throw new Error('esperava que translate lançasse')
  }

  it('erro de parse do SDK dentro de messages.parse ⇒ UnusableTranslationError', async () => {
    const err = await translateWith(() => {
      throw new Anthropic.AnthropicError('Failed to parse structured output as JSON: Unexpected end')
    })
    expect(err).toBeInstanceOf(UnusableTranslationError)
  })

  it('AnthropicError de credencial/config dentro de messages.parse ⇒ propaga como infraestrutura', async () => {
    const err = await translateWith(() => {
      throw new Anthropic.AnthropicError('Identity token file is empty')
    })
    expect(err).not.toBeInstanceOf(UnusableTranslationError)
    expect(isRowSpecificTranslationFailure(err)).toBe(false)
  })

  it('APIError (429) ⇒ propaga sem embrulho', async () => {
    const apiErr = Anthropic.APIError.generate(429, { error: { message: 'x' } }, 'x', new Headers())
    const err = await translateWith(() => {
      throw apiErr
    })
    expect(err).toBe(apiErr)
  })

  it('stop_reason refusal / max_tokens ⇒ UnusableTranslationError', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const err = await translateWith(async () => ({ stop_reason, parsed_output: null }))
      expect(err).toBeInstanceOf(UnusableTranslationError)
    }
  })

  it('saída infiel (título vazio) ⇒ UnusableTranslationError', async () => {
    const err = await translateWith(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { titulo: '', descricao: null, passos: null, notas: null, ingredientes: [] },
    }))
    expect(err).toBeInstanceOf(UnusableTranslationError)
  })
})

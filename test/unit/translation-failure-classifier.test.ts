import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  isRowSpecificTranslationFailure,
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

import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Chamada de teste do admin (ADR-0034 dec.5), com o SDK dublado: a Anthropic RECUSAR a combinação
 * (400/404) bloqueia o salvar com o motivo; não dar para testar (rede, credencial, limite, 5xx, conta
 * sem crédito) grava sem verificar.
 */
const { create, ctor } = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  class BadRequestError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  return {
    default: class {
      static BadRequestError = BadRequestError
      static NotFoundError = NotFoundError
      static RateLimitError = RateLimitError
      messages = { create }
      constructor(opts: unknown) {
        ctor(opts)
      }
    },
  }
})

vi.resetModules()
const { default: Anthropic } = await import('@anthropic-ai/sdk')
const { RealModelProbe } = await import('@/server/claude/model-probe')
const SDK = Anthropic as unknown as {
  BadRequestError: new (status: number, message: string) => Error
  NotFoundError: new (status: number, message: string) => Error
  RateLimitError: new (status: number, message: string) => Error
}

afterEach(() => {
  create.mockReset()
  ctor.mockReset()
})

describe('RealModelProbe', () => {
  it('manda o ajuste como parâmetros, com teto baixo e sem retry', async () => {
    create.mockResolvedValue({})
    const out = await new RealModelProbe().probe('claude-sonnet-5', { effort: 'low', thinking: 'off' })
    expect(out).toEqual({ kind: 'ok' })
    expect(ctor.mock.lastCall![0]).toMatchObject({ maxRetries: 0 })
    const params = create.mock.lastCall![0]
    expect(params).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 512,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    })
  })

  it('default/null não mandam thinking nem effort', async () => {
    create.mockResolvedValue({})
    await new RealModelProbe().probe('claude-opus-5-5', { effort: null, thinking: 'default' })
    const params = create.mock.lastCall![0]
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('output_config')
  })

  it('400/404 ⇒ rejected com a mensagem da API (com teto de tamanho)', async () => {
    create.mockRejectedValueOnce(new SDK.BadRequestError(400, 'thinking.type.disabled is not supported'))
    expect(await new RealModelProbe().probe('claude-opus-5-5', { effort: null, thinking: 'off' })).toEqual({
      kind: 'rejected',
      message: 'thinking.type.disabled is not supported',
    })
    create.mockRejectedValueOnce(new SDK.NotFoundError(404, 'x'.repeat(1000)))
    const out = await new RealModelProbe().probe('claude-opus-9', { effort: null, thinking: 'default' })
    expect(out.kind).toBe('rejected')
    expect(out.kind === 'rejected' && out.message).toHaveLength(300)
  })

  it('limite, rede, 5xx e conta sem crédito ⇒ unavailable (grava sem verificar)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors = [
      new SDK.RateLimitError(429, 'rate limited'),
      new TypeError('fetch failed'),
      Object.assign(new Error('overloaded'), { status: 529 }),
      new SDK.BadRequestError(400, 'Your credit balance is too low to access the Anthropic API.'),
    ]
    for (const err of errors) {
      create.mockRejectedValueOnce(err)
      expect(await new RealModelProbe().probe('claude-sonnet-5', { effort: null, thinking: 'off' })).toEqual({
        kind: 'unavailable',
      })
    }
  })
})

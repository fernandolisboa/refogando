import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Parâmetros que o `RealClaudeClient` manda à Anthropic na Geração (ADR-0033 dec.5), com o SDK
 * dublado: `effort` só p/ famílias selecionáveis (Haiku dá 400 com ele) e um sinal com prazo sempre
 * presente (a rota tem `maxDuration = 60`).
 */
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { parse }
  },
}))

// O setup (test/setup.ts) já carregou o client com o SDK real via deps.ts: recarrega com o dublê.
vi.resetModules()
const { RealClaudeClient } = await import('@/server/claude/client')

function input(model: string) {
  return { model, systemPrompt: 's', userPrompt: 'u' }
}

afterEach(() => {
  parse.mockReset()
})

describe('RealClaudeClient.generateRecipe — parâmetros', () => {
  it('Opus/Sonnet/Fable recebem effort medium e um sinal de prazo', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1']) {
      await expect(new RealClaudeClient().generateRecipe(input(model))).resolves.toEqual({ kind: 'refusal' })
      const [params, options] = parse.mock.lastCall!
      expect(params.model).toBe(model)
      expect(params.output_config.effort).toBe('medium')
      expect(params.max_tokens).toBe(12_000)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('modelo fora das famílias (Haiku legado) não recebe effort', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    await new RealClaudeClient().generateRecipe(input('claude-haiku-4-5-20251001'))
    expect(parse.mock.lastCall![0].output_config).not.toHaveProperty('effort')
  })

  it('variações: effort e teto de 20k (abaixo do limite de streaming do SDK)', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    await new RealClaudeClient().generateRecipeVariants(input('claude-opus-5-5'))
    const [params, options] = parse.mock.lastCall!
    expect(params.output_config.effort).toBe('medium')
    expect(params.max_tokens).toBe(20_000)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('abort do cliente HTTP ainda propaga pelo sinal combinado', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    const ctrl = new AbortController()
    await new RealClaudeClient().generateRecipe({ ...input('claude-opus-5-5'), signal: ctrl.signal })
    const { signal } = parse.mock.lastCall![1] as { signal: AbortSignal }
    expect(signal.aborted).toBe(false)
    ctrl.abort()
    expect(signal.aborted).toBe(true)
  })
})

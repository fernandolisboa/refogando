import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Parâmetros que o `RealClaudeClient` manda à Anthropic na Geração (ADR-0033 dec.5), com o SDK
 * dublado: `effort` só p/ famílias selecionáveis (Haiku dá 400 com ele) e um sinal com prazo sempre
 * presente (a rota tem `maxDuration = 60`).
 */
const { parse, stream } = vi.hoisted(() => ({ parse: vi.fn(), stream: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { parse, stream }
  },
}))

// O setup (test/setup.ts) já carregou o client com o SDK real via deps.ts: recarrega com o dublê.
vi.resetModules()
const { RealClaudeClient } = await import('@/server/claude/client')
const { RealTranslator } = await import('@/server/translation/translator')

function input(model: string) {
  return { model, systemPrompt: 's', userPrompt: 'u' }
}

afterEach(() => {
  parse.mockReset()
  stream.mockReset()
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

  it('modelo fora das famílias (Haiku legado) não recebe effort — nem com o ajuste default que as rotas passam', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    await new RealClaudeClient().generateRecipe(input('claude-haiku-4-5-20251001'))
    expect(parse.mock.lastCall![0].output_config).not.toHaveProperty('effort')
    await new RealClaudeClient().generateRecipe({
      ...input('claude-haiku-4-5-20251001'),
      settings: { effort: 'medium', thinking: 'default' },
    })
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

describe('ajustes por tarefa do admin (ADR-0034) viram parâmetros da request', () => {
  it('Geração: o ajuste salvo manda effort e thinking; o default não manda thinking', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal' })
    await new RealClaudeClient().generateRecipe({
      ...input('claude-sonnet-5'),
      settings: { effort: 'high', thinking: 'off' },
    })
    let params = parse.mock.lastCall![0]
    expect(params.output_config.effort).toBe('high')
    expect(params.thinking).toEqual({ type: 'disabled' })

    await new RealClaudeClient().generateRecipe(input('claude-opus-5-5'))
    params = parse.mock.lastCall![0]
    expect(params).not.toHaveProperty('thinking')
  })

  it('Extração: default da tarefa desliga o thinking e não manda effort; ajuste adaptativo ganha folga de tokens', async () => {
    parse.mockResolvedValue({ parsed_output: null })
    await new RealClaudeClient().extractIngredients(input('claude-sonnet-5'))
    const base = parse.mock.lastCall![0]
    expect(base.thinking).toEqual({ type: 'disabled' })
    expect(base.output_config).not.toHaveProperty('effort')

    await new RealClaudeClient().extractIngredients({
      ...input('claude-opus-5-5'),
      settings: { effort: 'low', thinking: 'adaptive' },
    })
    const tuned = parse.mock.lastCall![0]
    expect(tuned.model).toBe('claude-opus-5-5')
    expect(tuned.thinking).toEqual({ type: 'adaptive' })
    expect(tuned.output_config.effort).toBe('low')
    expect(tuned.max_tokens).toBeGreaterThan(base.max_tokens)
  })

  it('Tradução: usa o modelo e o ajuste que o loader devolve a cada chamada', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { titulo: 'T', descricao: 'D', passos: ['P'], notas: null },
    })
    const translator = new RealTranslator(async () => ({
      model: 'claude-opus-5-5',
      settings: { effort: 'medium', thinking: 'default' },
    }))
    await translator
      .translate({
        sourceLocale: 'pt-BR',
        targetLocale: 'en-US',
        fields: { titulo: 'T', descricao: 'D', passos: ['P'], notas: null },
      })
      .catch(() => undefined)
    const params = parse.mock.lastCall![0]
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.output_config.effort).toBe('medium')
    expect(params).not.toHaveProperty('thinking')
    // Thinking pode ligar ⇒ o teto ganha folga sobre o base da tradução.
    expect(params.max_tokens).toBeGreaterThan(4096)
  })

  it('Conversa: o stream usa o ajuste da Geração (thinking/effort do admin)', async () => {
    stream.mockReturnValue((async function* () {})())
    const turn = { systemPrompt: 's', transcript: [{ role: 'user' as const, content: 'oi' }] }
    const drain = async (it: AsyncIterable<string>) => {
      const out: string[] = []
      for await (const t of it) out.push(t)
      return out
    }
    await drain(
      new RealClaudeClient().streamConversation({
        ...turn,
        model: 'claude-sonnet-5',
        settings: { effort: 'low', thinking: 'off' },
      }),
    )
    let params = stream.mock.lastCall![0]
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.output_config).toEqual({ effort: 'low' })

    stream.mockReturnValue((async function* () {})())
    await drain(new RealClaudeClient().streamConversation({ ...turn, model: 'claude-haiku-4-5-20251001' }))
    params = stream.mock.lastCall![0]
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('output_config')
  })
})

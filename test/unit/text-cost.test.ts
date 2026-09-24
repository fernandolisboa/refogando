import { describe, expect, it } from 'vitest'
import { computeTextCost, TEXT_PRICE_TABLE, type TextUsage } from '@/domain/text-cost'
import { DEFAULT_TEXT_MODEL } from '@/domain/claude-models'

/**
 * Custo da geração de TEXTO (#463) — PURO/determinístico. Deriva `cost_usd` de `usage`+`model` pela
 * tabela de preço EM CÓDIGO. `usage` ausente ⇒ null; modelo desconhecido ⇒ null. Os números são um
 * SNAPSHOT (por isso gravamos, não recomputamos). Espelha o teste de image-cost.
 */

function usage(parts: Partial<TextUsage>): TextUsage {
  return { inputTokens: parts.inputTokens ?? 0, outputTokens: parts.outputTokens ?? 0 }
}

describe('computeTextCost — derivação do custo (snapshot)', () => {
  it('deriva o custo do modelo default (Opus 5.5): $4/1M input + $20/1M output', () => {
    // 1M input + 1M output = $4 + $20 = $24.
    const cost = computeTextCost(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), DEFAULT_TEXT_MODEL)
    expect(cost).toBe(24)
  })

  it('output pesa mais que input (taxa de saída maior)', () => {
    const soInput = computeTextCost(usage({ inputTokens: 1000 }), DEFAULT_TEXT_MODEL)!
    const soOutput = computeTextCost(usage({ outputTokens: 1000 }), DEFAULT_TEXT_MODEL)!
    expect(soOutput).toBeGreaterThan(soInput)
  })

  it('soma input + output ponderados pelas taxas/1M', () => {
    const rates = TEXT_PRICE_TABLE[DEFAULT_TEXT_MODEL]
    const u = usage({ inputTokens: 3200, outputTokens: 1500 })
    const esperado = (3200 * rates.inputPer1M + 1500 * rates.outputPer1M) / 1_000_000
    const cost = computeTextCost(u, DEFAULT_TEXT_MODEL)!
    expect(cost).toBeCloseTo(esperado, 6)
  })

  it('determinístico: a mesma entrada ⇒ o mesmo custo', () => {
    const u = usage({ inputTokens: 1234, outputTokens: 567 })
    expect(computeTextCost(u, DEFAULT_TEXT_MODEL)).toBe(computeTextCost(u, DEFAULT_TEXT_MODEL))
  })

  it('usage ausente (telemetria indisponível) ⇒ null (não finge 0)', () => {
    expect(computeTextCost(undefined, DEFAULT_TEXT_MODEL)).toBeNull()
  })

  it('uso TODO-ZERO ⇒ custo 0 (não null — telemetria presente, só não gastou)', () => {
    expect(computeTextCost(usage({}), DEFAULT_TEXT_MODEL)).toBe(0)
  })

  it('modelo desconhecido (fora da tabela) ⇒ null (preço desconhecido, honesto)', () => {
    expect(computeTextCost(usage({ outputTokens: 1000 }), 'modelo-inexistente-9000')).toBeNull()
  })

  it('mantém o preço de modelos antigos que já geraram Receitas (Sonnet 4.6)', () => {
    const cost = computeTextCost(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBe(18) // $3 + $15
  })

  it('arredonda a 6 casas decimais', () => {
    // 1 input token no Opus 5.5 = 4/1e6 = 0.000004 — exatamente 6 casas.
    expect(computeTextCost(usage({ inputTokens: 1 }), DEFAULT_TEXT_MODEL)).toBe(0.000004)
  })
})

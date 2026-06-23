import { describe, expect, it } from 'vitest'
import { computeImageCost, IMAGE_PRICE_TABLE, type ImageUsage } from '@/domain/image-cost'
import { DEFAULT_IMAGE_MODEL } from '@/domain/image-gen-config'

/**
 * Custo da geração de imagem (#224, ADR-0022 dec.4) — PURO/determinístico. Deriva `cost_usd` de
 * `usage`+`model` pela tabela de preço EM CÓDIGO. `usage` ausente ⇒ null; modelo desconhecido ⇒ null;
 * thinking tokens CONTAM. Os números são um SNAPSHOT (por isso gravamos, não recomputamos).
 */

/** Uso só com output (imagem) — `total` = soma das partes (forma do usageMetadata). */
function usage(parts: Partial<ImageUsage>): ImageUsage {
  const promptTokens = parts.promptTokens ?? 0
  const outputTokens = parts.outputTokens ?? 0
  const thinkingTokens = parts.thinkingTokens ?? 0
  return {
    promptTokens,
    outputTokens,
    thinkingTokens,
    totalTokens: parts.totalTokens ?? promptTokens + outputTokens + thinkingTokens,
  }
}

describe('computeImageCost — derivação do custo (snapshot)', () => {
  it('âncora do ADR: ~1290 tokens de output ⇒ ≈ $0.077', () => {
    const cost = computeImageCost(usage({ outputTokens: 1290 }), DEFAULT_IMAGE_MODEL)
    expect(cost).not.toBeNull()
    expect(cost!).toBeCloseTo(0.077, 3) // dentro de uma tolerância (~$0.0774)
  })

  it('thinking tokens ADICIONAM ao custo (cobrados mesmo ocultos)', () => {
    const semThinking = computeImageCost(usage({ outputTokens: 1290 }), DEFAULT_IMAGE_MODEL)!
    const comThinking = computeImageCost(
      usage({ outputTokens: 1290, thinkingTokens: 500 }),
      DEFAULT_IMAGE_MODEL,
    )!
    expect(comThinking).toBeGreaterThan(semThinking)
  })

  it('soma prompt + output + thinking ponderados pelas taxas/1M', () => {
    const rates = IMAGE_PRICE_TABLE[DEFAULT_IMAGE_MODEL]
    const u = usage({ promptTokens: 1000, outputTokens: 1290, thinkingTokens: 200 })
    const esperado =
      (1000 * rates.inputPer1M + 1290 * rates.outputPer1M + 200 * rates.thinkingPer1M) / 1_000_000
    const cost = computeImageCost(u, DEFAULT_IMAGE_MODEL)!
    expect(cost).toBeCloseTo(esperado, 6)
  })

  it('determinístico: a mesma entrada ⇒ o mesmo custo', () => {
    const u = usage({ promptTokens: 123, outputTokens: 1290, thinkingTokens: 45 })
    const a = computeImageCost(u, DEFAULT_IMAGE_MODEL)
    const b = computeImageCost(u, DEFAULT_IMAGE_MODEL)
    expect(a).toBe(b)
  })

  it('usage ausente (telemetria indisponível) ⇒ null (não finge 0)', () => {
    expect(computeImageCost(undefined, DEFAULT_IMAGE_MODEL)).toBeNull()
  })

  it('uso TODO-ZERO ⇒ custo 0 (não null — telemetria presente, só não gastou)', () => {
    expect(computeImageCost(usage({}), DEFAULT_IMAGE_MODEL)).toBe(0)
  })

  it('modelo desconhecido (fora da tabela) ⇒ null (preço desconhecido, honesto)', () => {
    expect(computeImageCost(usage({ outputTokens: 1290 }), 'modelo-inexistente-9000')).toBeNull()
  })

  it('arredonda a 6 casas decimais', () => {
    const cost = computeImageCost(usage({ outputTokens: 1 }), DEFAULT_IMAGE_MODEL)!
    // 1 * 60 / 1e6 = 0.00006 — exatamente 6 casas, sem cauda de ponto flutuante.
    expect(cost).toBe(0.00006)
  })
})

/**
 * Custo da geração de imagem por IA (#224, ADR-0022 dec.4) — PURO/total: tipos + tabela de preço EM
 * CÓDIGO + derivação determinística do `cost_usd`. Sem I/O, sem DB.
 *
 * Por que derivar e GRAVAR o custo (snapshot) em vez de recomputar sob demanda? Os preços do provedor
 * MUDAM com o tempo; recomputar uma geração antiga com a tabela de hoje mentiria sobre o que ela
 * custou. Então a tabela aqui é um SNAPSHOT (datado abaixo) e o custo derivado é PERSISTIDO na linha
 * `image_generation` no momento da geração — a história fica imutável mesmo quando os preços viram.
 *
 * O custo é DERIVADO do `usageMetadata` que o seam `ImageGenerator` agora devolve (tokens de prompt /
 * output-imagem / thinking / total). É BEST-EFFORT: se o provedor não mandou `usageMetadata`
 * (telemetria ausente) OU o modelo não está na tabela (preço desconhecido), devolvemos `null` —
 * HONESTO (não fingimos custo 0). A geração NUNCA falha por falta de telemetria: a linha do ledger
 * nasce com usage/custo nulos e o teto (por CONTAGEM, #167) segue intacto.
 */

/**
 * Uso normalizado de uma geração (forma estável, agnóstica do provedor). Mapeado do `usageMetadata`
 * do Gemini no seam: `promptTokenCount`→prompt, `candidatesTokenCount`→output (inclui a IMAGEM),
 * `thoughtsTokenCount`→thinking (cobrado MESMO quando oculto), `totalTokenCount`→total. Todos números.
 */
export type ImageUsage = {
  promptTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number
}

/** Taxas por 1.000.000 de tokens (USD), por categoria. */
export type ImageModelRates = {
  inputPer1M: number
  outputPer1M: number
  thinkingPer1M: number
}

/**
 * Tabela de preço EM CÓDIGO (modelo → taxas/1M de tokens), em USD. **SNAPSHOT de 2026-06-23** — os
 * preços do provedor mudam; por isso GRAVAMOS o `cost_usd` derivado na linha (não recomputamos depois).
 *
 * `gemini-3.1-flash-image` (Nano Banana 2, ADR-0017): a âncora do ADR é que uma imagem ≈ 1290 tokens
 * de output ⇒ ≈ $0.077, logo `outputPer1M ≈ $60/1M` (1290 × 60 / 1e6 = $0.0774). Input de texto é
 * barato (~$0.30/1M). Thinking tokens CONTAM (cobrados como output neste modelo de imagem).
 */
export const IMAGE_PRICE_TABLE: Record<string, ImageModelRates> = {
  'gemini-3.1-flash-image': {
    inputPer1M: 0.3,
    outputPer1M: 60,
    thinkingPer1M: 60,
  },
}

/** Casas decimais do custo persistido (sub-centavo de dólar — frações de imagem somam). */
const COST_DECIMALS = 6

/**
 * Deriva o `cost_usd` (USD) de um `usage` + `model` a partir da tabela de preço. PURO/determinístico.
 * - `usage` ausente (telemetria indisponível) ⇒ `null` (honesto; não finge 0).
 * - `model` fora da tabela (preço desconhecido) ⇒ `null` (snapshot honesto).
 * - senão: `(prompt·input + output·output + thinking·thinking) / 1e6`, arredondado a 6 casas.
 *   Os thinking tokens ADICIONAM ao custo (cobrados mesmo ocultos).
 */
export function computeImageCost(usage: ImageUsage | undefined, model: string): number | null {
  if (!usage) return null
  const rates = IMAGE_PRICE_TABLE[model]
  if (!rates) return null
  const raw =
    (usage.promptTokens * rates.inputPer1M +
      usage.outputTokens * rates.outputPer1M +
      usage.thinkingTokens * rates.thinkingPer1M) /
    1_000_000
  const factor = 10 ** COST_DECIMALS
  return Math.round(raw * factor) / factor
}

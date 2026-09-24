/**
 * Custo da geração de TEXTO por IA (#463) — PURO/total: tipos + tabela de preço EM CÓDIGO + derivação
 * determinística do `cost_usd`. Sem I/O, sem DB. ESPELHA `image-cost.ts` (#224, ADR-0022 dec.4): a
 * feature mais cara do app (Opus 4.8) passa a ser MEDIDA como a imagem já é.
 *
 * Por que derivar e GRAVAR o custo (snapshot) em vez de recomputar sob demanda? Os preços do provedor
 * MUDAM com o tempo; recomputar uma geração antiga com a tabela de hoje mentiria sobre o que ela
 * custou. Então a tabela aqui é um SNAPSHOT (datado abaixo) e o custo derivado é PERSISTIDO na linha
 * `generation` no momento da geração — a história fica imutável mesmo quando os preços viram.
 *
 * O custo é DERIVADO do `usage` (input/output tokens) que o seam `ClaudeClient` agora devolve junto do
 * `GenerationOutput`. É BEST-EFFORT: se o provedor não mandou usage (telemetria ausente) OU o modelo não
 * está na tabela (preço desconhecido), devolvemos `null` — HONESTO (não fingimos custo 0). A geração
 * NUNCA falha por falta de telemetria: a linha nasce com usage/custo nulos.
 */

/**
 * Uso normalizado de uma geração de texto (forma estável, agnóstica do provedor). Mapeado do
 * `message.usage` da Anthropic no seam: `input_tokens`→input, `output_tokens`→output. Cache-read/write
 * NÃO são modelados aqui (o custo de geração é dominado por input/output brutos; a mesma disciplina
 * best-effort/NULL-honesto cobre o resto).
 */
export type TextUsage = {
  inputTokens: number
  outputTokens: number
}

/** Taxas por 1.000.000 de tokens (USD), por categoria. */
export type TextModelRates = {
  inputPer1M: number
  outputPer1M: number
}

/**
 * Tabela de preço EM CÓDIGO (modelo → taxas/1M de tokens), em USD. **SNAPSHOT de 2026-07-05** — os
 * preços do provedor mudam; por isso GRAVAMOS o `cost_usd` derivado na linha (não recomputamos depois).
 *
 * Cobre os modelos que a Geração pode usar hoje (allowlist EM CÓDIGO em /api/admin/config:
 * `claude-opus-4-8`, `claude-sonnet-4-6`) mais alguns duráveis vizinhos, para que uma troca de
 * `default_model` não caia em NULL silenciosamente. Modelo fora da tabela ⇒ custo `null` (honesto).
 * `claude-sonnet-5` traz o preço padrão (o introdutório expira 2026-08-31; snapshot conservador).
 */
export const TEXT_PRICE_TABLE: Record<string, TextModelRates> = {
  'claude-opus-4-8': { inputPer1M: 5, outputPer1M: 25 },
  'claude-opus-4-7': { inputPer1M: 5, outputPer1M: 25 },
  'claude-sonnet-5': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
}

/** Casas decimais do custo persistido (sub-centavo de dólar — frações de geração somam). */
const COST_DECIMALS = 6

/**
 * Deriva o `cost_usd` (USD) de um `usage` + `model` a partir da tabela de preço. PURO/determinístico.
 * - `usage` ausente (telemetria indisponível) ⇒ `null` (honesto; não finge 0).
 * - `model` fora da tabela (preço desconhecido) ⇒ `null` (snapshot honesto).
 * - senão: `(input·input + output·output) / 1e6`, arredondado a 6 casas.
 */
export function computeTextCost(usage: TextUsage | undefined, model: string): number | null {
  if (!usage) return null
  const rates = TEXT_PRICE_TABLE[model]
  if (!rates) return null
  const raw =
    (usage.inputTokens * rates.inputPer1M + usage.outputTokens * rates.outputPer1M) / 1_000_000
  const factor = 10 ** COST_DECIMALS
  return Math.round(raw * factor) / factor
}

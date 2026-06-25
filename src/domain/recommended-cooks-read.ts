/**
 * Trilho "Cozinheiros pra seguir" (#278, ADR-0024) — DTO público + knobs do trilho de recomendados.
 *
 * v1 = popularidade GLOBAL (não-personalizada): ranqueia Cozinheiros pelo APREÇO DE TERCEIROS às suas
 * receitas públicas elegíveis (votos + favoritos), recência como desempate. NUNCA realimenta o ranking
 * do feed nem o gate de indexação (popularidade ≠ autoridade — CONTEXT.md). Camada B (personalizada por
 * gosto/grafo) e qualquer boost pago ficam DEFERIDOS (fora do v1).
 *
 * Allowlist (Modelo B / gate de DADOS, #269): o DTO NÃO carrega `id`/`email`/`role` — só o que o cartão
 * mostra (nome, @handle, avatar, contagem de receitas públicas elegíveis). Espelha `ProfileFollowUser`
 * (forma pública mínima) + `recipeCount`.
 */
export type RecommendedCook = {
  name: string
  handle: string
  image: string | null
  /** Quantas receitas PÚBLICAS ELEGÍVEIS o Cozinheiro tem (nunca conta privada/playful/moderada). */
  recipeCount: number
}

/** Máximo de cartões no trilho (top-N por popularidade). Reversível — knob de produto. */
export const RECOMMENDED_COOKS_LIMIT = 8

/**
 * Mínimo de candidatos para EXIBIR o trilho (AC "esconde quando candidatos < threshold"). Degrada
 * gracioso com pouca gente: abaixo disso o trilho some por inteiro. Reversível — knob de produto.
 */
export const RECOMMENDED_COOKS_MIN = 3

/**
 * Decide se o trilho aparece (gate de PRESENÇA, decisão de UI — o loader devolve a lista crua, sem
 * aplicar este piso). Fonte única do limiar para o componente cliente. `count` = candidatos retornados.
 */
export function shouldShowRecommendedRail(count: number): boolean {
  return count >= RECOMMENDED_COOKS_MIN
}

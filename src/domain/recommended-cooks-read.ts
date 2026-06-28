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
 * (forma pública mínima) + `recipeCount` + um preview BOUNDED (≤3) das receitas do Cozinheiro.
 */
export type RecommendedCook = {
  name: string
  handle: string
  image: string | null
  /** Quantas receitas PÚBLICAS ELEGÍVEIS o Cozinheiro tem (nunca conta privada/playful/moderada). */
  recipeCount: number
  /**
   * Preview das receitas PÚBLICAS ELEGÍVEIS mais NOVAS do Cozinheiro (≤ `RECOMMENDED_COOK_RECIPES_LIMIT`),
   * pro cartão rico do protótipo de telas largas (ADR-0024 emendado). DISTINTO de `recipeCount` (que é a
   * contagem TOTAL elegível). Allowlist: cada receita carrega SÓ o que o cartão mostra — NUNCA o
   * `owner_id`/`email`/`role` do dono nem o `image_id`/`recipe_translation.id` interno.
   */
  recipes: RecommendedCookRecipe[]
}

/**
 * Uma receita no preview do cartão de Cozinheiro recomendado (ADR-0024 emendado). Allowlist MÍNIMA: só
 * o necessário pra o thumbnail + título + link canônico. `displayedTitle` é resolvido em TS (mesma regra
 * do feed/busca, via `projectResult`) — NUNCA computado no SQL. `slug`/`imageUrl` ausentes ("ausente ≠
 * vazio") quando não há slug no locale pedido / não há imagem.
 */
export type RecommendedCookRecipe = {
  recipeId: string
  displayedTitle: string
  slug?: string
  imageUrl?: string
  imageAiGenerated?: boolean
}

/** Máximo de receitas no preview de CADA cartão (≤ por cozinheiro). Reversível — knob de produto. */
export const RECOMMENDED_COOK_RECIPES_LIMIT = 3

/** Máximo de cartões no trilho (top-N por popularidade). Reversível — knob de produto. */
export const RECOMMENDED_COOKS_LIMIT = 8

/**
 * Mínimo de candidatos para EXIBIR o trilho. `1` (pedido do dono, 2026-06-28): basta UM cozinheiro
 * recomendado pra o trilho/3ª-coluna aparecer — sem piso de quantidade. Só o caso VAZIO (0) esconde (não
 * faz sentido um trilho sem ninguém). Reversível — knob de produto (era 3; o degradar-gracioso-com-pouca-
 * gente foi abrandado de propósito pra a 3ª coluna pintar cedo, inclusive pré-seed #238).
 */
export const RECOMMENDED_COOKS_MIN = 1

/**
 * Decide se o trilho aparece (gate de PRESENÇA, decisão de UI — o loader devolve a lista crua, sem
 * aplicar este piso). Fonte única do limiar para o componente cliente. `count` = candidatos retornados.
 */
export function shouldShowRecommendedRail(count: number): boolean {
  return count >= RECOMMENDED_COOKS_MIN
}

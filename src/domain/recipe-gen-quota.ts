/**
 * Teto de GERAÇÃO DE RECEITA por IA — janela de 24h DESLIZANTE (issue #167). PURO/total: decide se
 * cabe MAIS uma geração e, quando estoura, em quanto tempo o próximo slot libera (countdown).
 *
 * ESPELHA `@/domain/image-quota` (`decideImageQuota`): MESMA semântica de janela deslizante de 24h —
 * a única com teto de custo realmente DURO (≤ cap gerações em QUALQUER janela de 24h) e sem o
 * incentivo perverso de empilhar gerações na virada da meia-noite. Aqui o insumo são os `created_at`
 * das `generation` JÁ persistidas do usuário (contadas via `creation_session.user_id`) — SEM ledger
 * novo: a contagem reusa os registros de geração que já existem.
 *
 * O `cap` chega por PARÂMETRO (não lido aqui): a RESOLUÇÃO do cap por papel (defaults + `null`=∞,
 * fail-closed) vive em `@/domain/recipe-gen-config` (`capFromRecipeGenConfig`) — fonte ÚNICA.
 */

/** Janela deslizante de 24h em ms (espelha IMAGE_GEN_WINDOW_MS). */
export const RECIPE_GEN_WINDOW_MS = 24 * 60 * 60 * 1000

export type RecipeGenQuotaDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number } // countdown até o próximo slot na janela deslizante

/**
 * Decide se cabe MAIS uma geração. `recentAt` são os `created_at` das gerações do usuário (qualquer
 * janela — filtramos a 24h aqui). `cap = Infinity` (admin/papel ilimitado) ⇒ sempre permite.
 * Estourado ⇒ `retryAfterMs` = quando o N-ésimo mais antigo DENTRO da janela sai dela (o slot que
 * libera a próxima). PURO: `now` é injetado (sem `Date.now()` interno). Mesma máquina de
 * `decideImageQuota` — qualquer divergência de cálculo seria um bug.
 */
export function decideRecipeGenQuota(input: {
  cap: number
  recentAt: ReadonlyArray<Date>
  now: Date
}): RecipeGenQuotaDecision {
  const { cap, recentAt, now } = input
  if (!Number.isFinite(cap)) return { allowed: true } // ∞ (papel ilimitado)
  // Teto ZERO/negativo (config pode zerar um papel) ⇒ NUNCA permite; countdown = janela cheia (não
  // há slot que libere antes). Sem esta guarda, o `idx` viraria negativo e o cálculo NaN.
  if (cap <= 0) return { allowed: false, retryAfterMs: RECIPE_GEN_WINDOW_MS }

  const nowMs = now.getTime()
  const windowStart = nowMs - RECIPE_GEN_WINDOW_MS
  const inWindow = recentAt
    .map((d) => d.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b)

  if (inWindow.length < cap) return { allowed: true }

  // Estourou: pra caber mais uma, (inWindow.length - cap + 1) das mais antigas precisam expirar; a
  // (inWindow.length - cap)-ésima (0-based) é a que, ao sair da janela, libera o slot.
  const idx = inWindow.length - cap
  const freesAt = inWindow[idx] + RECIPE_GEN_WINDOW_MS
  return { allowed: false, retryAfterMs: Math.max(0, freesAt - nowMs) }
}

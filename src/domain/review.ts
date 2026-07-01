/**
 * Regra de domínio da AVALIAÇÃO — módulo PURO (issue #363, ADR-0027). Espelha o padrão
 * `decide*` de `vote.ts` (decisão total/determinística, zero DB/I/O).
 *
 * Decide os julgamentos de borda da Avaliação: nota 1–5 VÁLIDA, comentário NORMALIZADO
 * (trim + cap) e NÃO-AUTO-AVALIAÇÃO. Avaliar a PRÓPRIA Receita é rejeitado
 * (`reviewerId === recipeOwnerId`); Catálogo/sistema tem `recipeOwnerId === null`, que
 * NUNCA casa com um `reviewerId` (string) ⇒ Catálogo é sempre avaliável (AC "comunidade E
 * catálogo"). A UNICIDADE (1 por par) NÃO mora aqui: é a UNIQUE `(user_id, recipe_id)` +
 * `ON CONFLICT DO UPDATE` no servidor. A ELEGIBILIDADE de POOL também NÃO mora aqui: fica no
 * gate do servidor (`loadReviewGate` reusando `eligibleForPool`) — o MESMO split de
 * `decideVote`/`loadPoolGate`.
 *
 * LANDMINE (sem rede de banco): NÃO há CHECK de auto-avaliação no schema (owner_id mora em
 * `recipe`, não em `recipe_review`; um CHECK cross-table exigiria trigger). Logo, ESTE
 * predicado é a única guarda. `applyReview` (server/recipe/review.ts) é o ÚNICO escritor de
 * `recipe_review` e o único chamador de `decideReview`. Qualquer FUTURO segundo escritor
 * (ex.: o emit da notificação #371) DEVE também chamar `decideReview`.
 */

/**
 * Cap de comprimento do comentário (server-controlled; reversível). Precedente
 * `MAX_TEXT_LENGTH=500` (catalog-disclosure-config), mas a Avaliação é long-form → 2000.
 * O cap protege o armazenamento e o payload re-servido no GET cacheável (anti-DoS).
 */
export const MAX_REVIEW_COMMENT_LEN = 2000

export type ReviewDecision =
  // `comment` já vem TRIMADO e normalizado ('' → null).
  | { allowed: true; comment: string | null }
  | { allowed: false; reason: 'invalid_rating' | 'invalid_comment' | 'auto_review' }

export function decideReview(input: {
  reviewerId: string
  recipeOwnerId: string | null
  rating: number
  comment: unknown // cru do fio; narrado/validado aqui
}): ReviewDecision {
  // 1) Nota inteira em 1–5 (NaN/decimal/fora-de-faixa recusa).
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { allowed: false, reason: 'invalid_rating' }
  }

  // 2) Comentário: só string conta; NUL (U+0000) removido; trim; cap; '' → null. Um valor
  //    não-string (objeto/número) vira '' (ausente) — NUNCA bind de `[object Object]` num text
  //    param nem 500. O NUL sobrevive ao trim() e o Postgres o REJEITA em param text → 500 não
  //    tratado (mesmo perigo documentado em search-terms.ts); tiramos SÓ o NUL (não a classe C0
  //    inteira) para preservar \n/\t de um comentário long-form (a UI renderiza whitespace-pre-line).
  const c =
    typeof input.comment === 'string' ? input.comment.replace(/\x00/g, '').trim() : ''
  if (c.length > MAX_REVIEW_COMMENT_LEN) {
    return { allowed: false, reason: 'invalid_comment' }
  }

  // 3) Não-auto-avaliação: owner null (Catálogo) nunca casa ⇒ Catálogo é avaliável.
  if (input.recipeOwnerId !== null && input.reviewerId === input.recipeOwnerId) {
    return { allowed: false, reason: 'auto_review' }
  }

  return { allowed: true, comment: c === '' ? null : c }
}

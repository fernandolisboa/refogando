/**
 * Regra de domínio do VOTO — módulo PURO (issue #16, ADR-0003). Espelha o padrão
 * `decide*` de `recipe-visibility.ts` (decisão total/determinística, zero DB/I/O).
 *
 * Decide o ÚNICO julgamento de domínio do voto: NÃO-AUTOVOTO (AC2). Votar na PRÓPRIA
 * Receita é rejeitado — `voterId === recipeOwnerId` ⇒ recusa. Catálogo/sistema tem
 * `recipeOwnerId === null`, que NUNCA casa com um `voterId` (string) ⇒ Catálogo é
 * sempre votável. A IDEMPOTÊNCIA (votar 2× = um voto) NÃO mora aqui: é a PK composta
 * `(user_id, recipe_id)` + `ON CONFLICT DO NOTHING` no servidor.
 *
 * LANDMINE (sem rede de banco): NÃO há CHECK de não-autovoto no schema (owner_id mora em
 * `recipe`, não em `recipe_vote`; um CHECK cross-table exigiria trigger). Logo, ESTE
 * predicado é a única guarda do AC2. `applyVote` (server/recipe/social.ts) é o ÚNICO
 * escritor de `recipe_vote` e o único chamador de `decideVote`. Qualquer FUTURO segundo
 * escritor de voto DEVE também chamar `decideVote`, ou o AC2 fura silenciosamente.
 */

export type VoteDecision = { allowed: true } | { allowed: false; reason: 'auto_voto' }

export function decideVote(input: {
  voterId: string
  recipeOwnerId: string | null
}): VoteDecision {
  // Não-autovoto (AC2): owner null (catálogo) nunca casa ⇒ Catálogo é votável.
  if (input.recipeOwnerId !== null && input.voterId === input.recipeOwnerId) {
    return { allowed: false, reason: 'auto_voto' }
  }
  return { allowed: true }
}

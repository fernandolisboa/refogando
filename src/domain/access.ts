import { ROLE_RANK, type Role } from '@/domain/user'

/**
 * Decisão de gating PURA (issue #5, ADR-0011) — sem DB, sem Better Auth. Extraída do
 * guard para ser testável em unidade (`decideRole`): mapeia (papel atual, papel mínimo)
 * para um veredito que o `requireRole` traduz em 401/403/allow.
 *
 *  - `unauthenticated`: não há papel (Visitante, sem sessão) → 401.
 *  - `forbidden`: há papel, mas insuficiente OU desconhecido → 403.
 *  - `allow`: papel >= mínimo.
 *
 * FAIL-CLOSED (E11): um papel fora de `ROLE_RANK` (rank `undefined`) NUNCA passa — vira
 * `forbidden`, jamais `allow`. Comparar `undefined < n` daria `false` (NaN), o que já
 * barraria, mas tratamos `undefined` explicitamente para a intenção ficar inequívoca e
 * imune a refator.
 */
export type AccessDecision = 'allow' | 'unauthenticated' | 'forbidden'

export function decideRole(role: Role | null, min: Role): AccessDecision {
  if (role === null) return 'unauthenticated'
  const rank = ROLE_RANK[role]
  // E11 — papel desconhecido (rank undefined) é fail-closed: forbidden, nunca allow.
  if (rank === undefined || rank < ROLE_RANK[min]) return 'forbidden'
  return 'allow'
}

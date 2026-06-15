/**
 * Máquina de transição de Visibilidade da Receita — módulo PURO (issue #13, §2.1).
 *
 * Espelha o padrão `decide*` de `stale-rule.ts` (decisão pura, zero DB/I/O). NÃO
 * estende `recipe.ts` (esse é o kernel de pertencimento: arrays `as const` + type
 * guards; transição é outra responsabilidade — decisão, não classificação).
 *
 * Duas regras de domínio, nessa ordem:
 *  1. ADR-0013: zoeira (`result_kind='playful'`) NUNCA vira pública. Alvo público +
 *     playful ⇒ recusa (`playful_nao_publicavel`), para qualquer `current`.
 *  2. Idempotência: alvo == atual ⇒ no-op (`changed:false`, sem UPDATE).
 *
 * `degraded` é publicável (paridade com `success`). A regra é "não PUBLICAR zoeira",
 * não "zoeira é intransicionável": despublicar uma playful (target='private') é
 * permitido (quase sempre no-op, pois playful nasce private).
 */

import type { ResultKind, Visibility } from '@/domain/recipe'

export type VisibilityTransition =
  | { allowed: true; changed: boolean }
  | { allowed: false; reason: 'playful_nao_publicavel' }

export function decideVisibilityTransition(input: {
  resultKind: ResultKind
  current: Visibility
  target: Visibility
}): VisibilityTransition {
  // Regra 1 (ADR-0013): publicar zoeira é recusado, qualquer que seja o estado atual.
  if (input.target === 'public' && input.resultKind === 'playful') {
    return { allowed: false, reason: 'playful_nao_publicavel' }
  }
  // Regra 2: idempotência — só muda quando o alvo difere do atual.
  return { allowed: true, changed: input.target !== input.current }
}

/**
 * Máquina de transição de Visibilidade da Receita — módulo PURO (issue #13, §2.1).
 *
 * Espelha o padrão `decide*` de `stale-rule.ts` (decisão pura, zero DB/I/O). NÃO
 * estende `recipe.ts` (esse é o kernel de pertencimento: arrays `as const` + type
 * guards; transição é outra responsabilidade — decisão, não classificação).
 *
 * Três regras de domínio, nessa ordem (recusas antes da idempotência):
 *  1. ADR-0019 (#168): receita IMPORTADA DA WEB (`origin='web_imported'`) NUNCA vira
 *     pública — republicar conteúdo de terceiros no nome do usuário é proibido. Alvo
 *     público + web_imported ⇒ recusa (`web_imported_nao_publicavel`), para qualquer
 *     `current`/`resultKind`. PRECEDÊNCIA sobre o playful (proveniência é a recusa mais
 *     forte; a importada não tem `result_kind` de criação própria, mas a checagem vem
 *     antes para que o motivo reportado seja sempre o de proveniência).
 *  2. ADR-0013: zoeira (`result_kind='playful'`) NUNCA vira pública. Alvo público +
 *     playful ⇒ recusa (`playful_nao_publicavel`), para qualquer `current`.
 *  3. Idempotência: alvo == atual ⇒ no-op (`changed:false`, sem UPDATE).
 *
 * `degraded` é publicável (paridade com `success`). As regras são "não PUBLICAR" (zoeira
 * ou importada), não "intransicionável": despublicar (target='private') é sempre
 * permitido (quase sempre no-op, pois ambas nascem private).
 */

import type { Origin, ResultKind, Visibility } from '@/domain/recipe'

export type VisibilityTransition =
  | { allowed: true; changed: boolean }
  | { allowed: false; reason: 'playful_nao_publicavel' | 'web_imported_nao_publicavel' }

export function decideVisibilityTransition(input: {
  origin: Origin
  resultKind: ResultKind
  current: Visibility
  target: Visibility
}): VisibilityTransition {
  // Regra 1 (ADR-0019): publicar uma importada da web é recusado, qualquer que seja o
  // estado atual. Vem ANTES do playful — proveniência tem precedência.
  if (input.target === 'public' && input.origin === 'web_imported') {
    return { allowed: false, reason: 'web_imported_nao_publicavel' }
  }
  // Regra 2 (ADR-0013): publicar zoeira é recusado, qualquer que seja o estado atual.
  if (input.target === 'public' && input.resultKind === 'playful') {
    return { allowed: false, reason: 'playful_nao_publicavel' }
  }
  // Regra 3: idempotência — só muda quando o alvo difere do atual.
  return { allowed: true, changed: input.target !== input.current }
}

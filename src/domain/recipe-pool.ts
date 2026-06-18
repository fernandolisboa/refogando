/**
 * Elegibilidade de POOL da Receita — predicado PURO single-source (issue #18).
 *
 * O "pool" (Comunidade + Catálogo) é o conjunto de Receitas legíveis/votáveis por
 * qualquer um. Historicamente o gate era `(owner_id IS NULL OR visibility='public') AND
 * result_kind <> 'playful'` (espalhado por `search.ts`/`social.ts`/`route.ts`). A #18
 * adiciona a DIMENSÃO de MODERAÇÃO: uma Receita removida do pool pelo Curador
 * (`moderation_removed_at IS NOT NULL`) sai do pool SEM tocar `visibility` — remover-do-pool
 * é DISTINTO de despublicar (AC3), e as duas dimensões são ortogonais (republicar não
 * ressuscita uma Receita moderada).
 *
 * Esta função é a fonte única do predicado em JS (`social.ts loadPoolGate` + os núcleos de
 * `report.ts`/`moderation.ts`). `search.ts` é SQL cru e NÃO pode chamar JS — lá o predicado
 * `AND moderation_removed_at IS NULL` é replicado verbatim em cada gate, com comentário
 * apontando para aqui (faltar UM gate = vaza Receita removida).
 */
export function eligibleForPool(r: {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
}): boolean {
  return (
    (r.ownerId == null || r.visibility === 'public') &&
    r.resultKind !== 'playful' &&
    r.moderationRemovedAt == null
  )
}

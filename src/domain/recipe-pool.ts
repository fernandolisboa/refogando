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
 *
 * #168/ADR-0019: `origin <> 'web_imported'` é DEFENSE-IN-DEPTH. Uma importada da web é sempre
 * private e não-publicável (o guard de visibilidade já a barra de virar pública, então o ramo
 * `visibility='public'` nunca a alcança), mas excluí-la explicitamente aqui é cinto-e-suspensório:
 * se um bug futuro vazasse uma importada para `public`, ela AINDA assim não entraria no pool.
 */
export function eligibleForPool(r: {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string
}): boolean {
  return (
    (r.ownerId == null || r.visibility === 'public') &&
    r.resultKind !== 'playful' &&
    r.moderationRemovedAt == null &&
    r.origin !== 'web_imported'
  )
}

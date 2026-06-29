import type { Visibility } from '@/domain/recipe'
import { isCatalogPubliclyCurated, type CurationStatus } from '@/domain/recipe-curation'

/**
 * Visibilidade de COMUNIDADE da Receita — predicado PURO single-source (issue #52).
 *
 * A regra define o que é COMUNIDADE: Catálogo (owner NULL = sistema, ADR-0011) **e CURADO**
 * (#238/ADR-0026: o catálogo só é público quando `curation_status='approved'` — um rascunho
 * pending/editing/rejected fica ESCONDIDO) OU Receita publicada por um usuário. É a base do
 * gate de LEITURA pública do GET/derive/traduções e do recorte de comunidade da Busca/feed.
 *
 * Ponto único de edição da regra de visibilidade-de-comunidade; um novo valor de
 * visibilidade (ex.: `unlisted`) é alterado SÓ aqui. `curationStatus` é OBRIGATÓRIO (sem
 * default) DE PROPÓSITO: o compilador então acusa todo caller, que passa a SELECIONAR
 * `curation_status` — fail-closed (a regra de catálogo nunca é esquecida num caller).
 *
 * ORTOGONAL à moderação (`moderation_removed_at`, #18) e ao `result_kind` (#16/#18): cada
 * chamador combina ESTE predicado com os filtros adicionais que o seu gate exige — `route.ts`
 * com `moderationRemovedAt`, o pool com `eligibleForPool` (que soma playful + moderação). Não
 * conflar leitura-de-acesso com elegibilidade-de-pool.
 */
export function isCommunityVisible(
  ownerId: string | null,
  visibility: Visibility,
  curationStatus: CurationStatus,
): boolean {
  return (ownerId == null && isCatalogPubliclyCurated(curationStatus)) || visibility === 'public'
}

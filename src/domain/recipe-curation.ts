/**
 * Estado de CURADORIA da Receita de catálogo — kernel de domínio (issue #238, ADR-0026).
 *
 * Mesma forma de `report.ts`/`vocabulary-term.ts`: array `as const` + tipo derivado + guard
 * puro. `schema.ts` mapeia `CURATION_STATUSES` para `pgEnum('curation_status')`.
 *
 * O catálogo (`origin=catalog`, owner-null) passa a ter um estado de RETENÇÃO de pré-publicação:
 * um rascunho — inclusive rascunhado por IA (o seed) — fica ESCONDIDO até um Curador aprovar.
 * É a EXCEÇÃO EDITORIAL da indexação default-open (ADR-0020 dec.6: o catálogo é curado por nós
 * por definição), NÃO um gate sobre receita de usuário. Os estados PARTICIONAM por dono:
 *
 *  Catálogo (owner-null) vive o ciclo:
 *   - `pending`  — rascunho na fila, intocado. ESCONDIDO. (saída do seed)
 *   - `editing`  — o Curador está refinando o rascunho. ESCONDIDO (não pisca público no meio).
 *   - `approved` — curado e assinado: PÚBLICO + selo editorial + entra em Busca/Feed/sitemap.
 *   - `rejected` — recusado: TOMBSTONE (guardado p/ rastreio/medição, revisitável; nunca público).
 *
 *  Usuário (owner-not-null):
 *   - `not_required` — curadoria de catálogo NÃO se aplica; quem governa o público é a
 *     Visibilidade (self-publish, ADR-0003, default-open intacto). É o DEFAULT da coluna.
 */
export const CURATION_STATUSES = [
  'pending',
  'editing',
  'approved',
  'rejected',
  'not_required',
] as const
export type CurationStatus = (typeof CURATION_STATUSES)[number]

export function isCurationStatus(v: string): v is CurationStatus {
  return (CURATION_STATUSES as readonly string[]).includes(v)
}

/**
 * Os estados que a FILA do Curador mostra (rascunhos ainda não decididos). `rejected` é
 * tombstone (lista à parte); `approved`/`not_required` saíram da fila.
 */
export const CURATION_QUEUE_STATUSES = ['pending', 'editing'] as const

/**
 * Predicado PURO single-source do ramo CATÁLOGO do gate de leitura pública: uma Receita
 * owner-null (catálogo) só é pública/elegível quando `approved`. `pending`/`editing`/`rejected`
 * ⇒ escondido; `not_required` (que só aparece em receita de usuário) nunca casa ⇒ fail-closed.
 * Reusado por `isCommunityVisible`, `eligibleForPool`, `eligibleForPublicRead` e espelhado nos
 * fragmentos SQL crus (`visibility-sql.ts`) — um só lugar define "rascunho de catálogo é público?".
 */
export function isCatalogPubliclyCurated(status: CurationStatus): boolean {
  return status === 'approved'
}

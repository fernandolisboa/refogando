/**
 * Kernel de domínio da auditoria DSAR (issue #395, GAP-5 — `docs/legal/takedown-e-remocao-titular.md` §5).
 * Mesma forma dos demais kernels (`REPORT_STATUSES`/`NOTIFICATION_TYPES`): array `as const` + tipo
 * derivado + guard puro. `schema.ts` mapeia `DSAR_EVENT_TYPES` → `pgEnum('dsar_event_type')`.
 *
 * Os 4 eventos do ciclo de vida de um pedido do titular (LGPD Art. 18) — códigos de auditoria em CAIXA
 * ALTA (nomes canônicos do §5, tratados como códigos de log, não como estado de domínio):
 *  - `DSAR_RECEIVED`          — pedido recebido (canal, tipo, data). MARCA o início do SLA de 15 dias.
 *  - `DSAR_IDENTITY_VERIFIED` — identidade mínima confirmada (método).
 *  - `DSAR_FULFILLED`         — pedido atendido; grava o HASH do que mudou (NUNCA o dado em claro).
 *  - `DSAR_REJECTED`          — pedido recusado (motivo).
 *
 * Nesta fatia SÓ `DSAR_FULFILLED` é EMITIDO (por `clearSourceAttribution`, na remoção EFETIVA do nome).
 * Os outros 3 entram no enum de uma vez (completude) e ficam graváveis pelo fluxo do operador (GAP-4).
 */
export const DSAR_EVENT_TYPES = [
  'DSAR_RECEIVED',
  'DSAR_IDENTITY_VERIFIED',
  'DSAR_FULFILLED',
  'DSAR_REJECTED',
] as const

export type DsarEventType = (typeof DSAR_EVENT_TYPES)[number]

/** Guard de borda: um `type` cru (de DB/entrada) é um `DsarEventType` conhecido? */
export function isDsarEventType(v: string): v is DsarEventType {
  return (DSAR_EVENT_TYPES as readonly string[]).includes(v)
}

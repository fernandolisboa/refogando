import { createHash } from 'node:crypto'
import type { Database } from '@/db/client'
import { dsarAuditEvent } from '@/db/schema'
import type { DsarEventType } from '@/domain/dsar'

/**
 * Gravação da trilha de auditoria DSAR — APPEND-ONLY (issue #395, GAP-5;
 * `docs/legal/takedown-e-remocao-titular.md` §5). Este módulo é a ÚNICA porta de escrita da tabela
 * `dsar_audit_event`, e expõe SÓ `recordDsarEvent` (INSERT). NÃO há — e não deve haver — nenhuma função
 * de UPDATE/DELETE de registros de auditoria: append-only é garantido pela ausência desses caminhos.
 *
 * `recordDsarEvent` é reutilizável pelos 4 tipos: nesta fatia SÓ `DSAR_FULFILLED` é EMITIDO (por
 * `clearSourceAttribution`, na remoção efetiva do nome); os outros 3 ficam prontos para o fluxo do
 * operador (GAP-4). Aceita `Database` OU uma transação (`Tx`) — o wire de `clearSourceAttribution`
 * grava o evento na MESMA tx do UPDATE (atomicidade: ou remove-e-audita, ou nada).
 */

/** A callback de `db.transaction` recebe um cliente de transação; aceitamos ambos (mesmo `insert`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type DsarAuditDb = Database | Tx

/**
 * Payload do `DSAR_FULFILLED` que é HASHEADO (nunca persistido em claro). O `removedSourceName` é o
 * único dado sensível — entra SÓ no hash (prova o que foi removido sem re-armazenar o nome). O
 * `sort()` dos `recipeIds` torna o hash estável independente da ordem de entrada.
 */
export type DsarFulfillmentPayload = {
  recipeIds: string[]
  removedSourceName: string
  ts: string // ISO-8601
}

/** SHA-256 (hex) do payload canônico do `DSAR_FULFILLED`. PURO/determinístico. */
export function hashDsarFulfillment(payload: DsarFulfillmentPayload): string {
  const canonical = JSON.stringify({
    recipeIds: [...payload.recipeIds].sort(),
    removedSourceName: payload.removedSourceName,
    ts: payload.ts,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Entrada de `recordDsarEvent`. Discriminada por `eventType`: cada tipo EXIGE o seu campo primário
 * (RECEIVED→canal+tipo; IDENTITY_VERIFIED→método; FULFILLED→payload a hashear; REJECTED→motivo);
 * os demais campos são opcionais e compartilhados (ator, ticket, metadados não-sensíveis).
 */
export type RecordDsarEventInput = {
  actorId?: string | null
  caseId?: string | null
  channel?: string | null
  requestType?: string | null
  verificationMethod?: string | null
  reason?: string | null
  /** SÓ metadados NÃO-sensíveis (ids internos, contagens). NUNCA dado pessoal do titular em claro. */
  details?: Record<string, unknown>
} & (
  | { eventType: Extract<DsarEventType, 'DSAR_RECEIVED'>; channel: string; requestType: string }
  | { eventType: Extract<DsarEventType, 'DSAR_IDENTITY_VERIFIED'>; verificationMethod: string }
  | { eventType: Extract<DsarEventType, 'DSAR_FULFILLED'>; fulfillment: DsarFulfillmentPayload }
  | { eventType: Extract<DsarEventType, 'DSAR_REJECTED'>; reason: string }
)

/**
 * Grava UM evento de auditoria DSAR (INSERT append-only). O `payload_hash` é derivado do `fulfillment`
 * só no `DSAR_FULFILLED` — os demais tipos ficam com hash nulo. Retorna o `id` do registro gravado.
 */
export async function recordDsarEvent(db: DsarAuditDb, input: RecordDsarEventInput): Promise<string> {
  const payloadHash =
    input.eventType === 'DSAR_FULFILLED' ? hashDsarFulfillment(input.fulfillment) : null
  const [row] = await db
    .insert(dsarAuditEvent)
    .values({
      eventType: input.eventType,
      caseId: input.caseId ?? null,
      actorId: input.actorId ?? null,
      channel: input.channel ?? null,
      requestType: input.requestType ?? null,
      verificationMethod: input.verificationMethod ?? null,
      payloadHash,
      reason: input.reason ?? null,
      details: input.details ?? null,
    })
    .returning({ id: dsarAuditEvent.id })
  return row.id
}

import { stripControlChars } from '@/domain/search-terms'

/**
 * Kernel de domínio do INTAKE público de takedown / pedido do titular (issue #399, GAP-2 —
 * `docs/legal/takedown-e-remocao-titular.md` §2). PURO (sem DB, sem I/O): recebe o corpo cru do
 * formulário público (não-logado) e o normaliza/valida nos campos MÍNIMOS que abrem um ticket.
 *
 * Minimização (LGPD Art. 6º, III): o formulário coleta só o necessário para localizar o conteúdo e
 * entender o pedido — URL de origem e/ou nome exibido + o pedido em texto. NÃO exige documento nem
 * qualquer PII adicional como condição. O contato de retorno é OPCIONAL (não bloqueia o envio).
 *
 * Anti-500: cada campo passa por `stripControlChars` (U+0000..U+001F → espaço) ANTES de ir ao banco —
 * um NUL sobrevive ao `trim()` e o postgres-js estoura (→ 500) num param `text` com NUL. Mesmo
 * sanitizador da borda da Busca (`@/domain/search-terms`), fonte única.
 */

/** Tipos de pedido oferecidos no formulário. `other` é o fallback permissivo (nunca 500 por tipo cru). */
export const TAKEDOWN_REQUEST_TYPES = ['name_removal', 'full_removal', 'other'] as const

export type TakedownRequestType = (typeof TAKEDOWN_REQUEST_TYPES)[number]

/** Guard de borda: um `type` cru (do corpo do form) é um `TakedownRequestType` conhecido? */
export function isTakedownRequestType(v: string): v is TakedownRequestType {
  return (TAKEDOWN_REQUEST_TYPES as readonly string[]).includes(v)
}

/** Teto dos campos curtos (url/nome/contato) e do corpo do pedido. Barra um envio abusivo (anti-DoS). */
export const TAKEDOWN_FIELD_MAX = 500
export const TAKEDOWN_MESSAGE_MAX = 4000

/** Corpo cru do formulário (tudo `unknown`: vem de `request.json()`, não confiável). */
export type TakedownIntakeInput = {
  requestType?: unknown
  sourceUrl?: unknown
  displayName?: unknown
  message?: unknown
  contactEmail?: unknown
}

/** Pedido já normalizado e pronto para virar ticket (campos saneados; identificação garantida). */
export type NormalizedTakedown = {
  requestType: TakedownRequestType
  sourceUrl: string | null
  displayName: string | null
  message: string
  contactEmail: string | null
}

/** Códigos de erro de validação (chaves i18n visíveis no form; NUNCA mensagem crua do servidor). */
export type TakedownIntakeError = 'pedido_obrigatorio' | 'identificacao_obrigatoria'

export type TakedownValidation =
  | { ok: true; value: NormalizedTakedown }
  | { ok: false; error: TakedownIntakeError }

/** Sanitiza um campo curto de texto: só-string → strip C0 → trim → corta ao teto → vazio vira null. */
function cleanShort(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = stripControlChars(v).trim().slice(0, TAKEDOWN_FIELD_MAX)
  return s.length > 0 ? s : null
}

/**
 * Normaliza + valida o corpo do formulário público de intake. PURA. Regras:
 *  - `requestType`: um tipo conhecido, ou `other` (fallback — nunca rejeita por tipo).
 *  - `message` (o pedido): obrigatório e não-vazio após sanitizar → senão `pedido_obrigatorio`.
 *  - identificação: exige AO MENOS um de `sourceUrl`/`displayName` → senão `identificacao_obrigatoria`.
 *  - `contactEmail`: OPCIONAL (não é condição de atendimento — Art. 6º, III); apenas saneado.
 *
 * `message` usa `stripControlChars`, que troca também `\n` por espaço — aceitável: o ticket é lido pelo
 * operador e o requisito duro é anti-500 (NUL). A identificação vem ANTES da checagem de tipo por
 * clareza; a ordem dos erros é message → identificação (o pedido é o núcleo).
 */
export function normalizeTakedownIntake(input: TakedownIntakeInput): TakedownValidation {
  const requestType =
    typeof input.requestType === 'string' && isTakedownRequestType(input.requestType)
      ? input.requestType
      : 'other'

  const sourceUrl = cleanShort(input.sourceUrl)
  const displayName = cleanShort(input.displayName)
  const contactEmail = cleanShort(input.contactEmail)

  const message =
    typeof input.message === 'string'
      ? stripControlChars(input.message).trim().slice(0, TAKEDOWN_MESSAGE_MAX)
      : ''
  if (message.length === 0) return { ok: false, error: 'pedido_obrigatorio' }

  if (sourceUrl === null && displayName === null) {
    return { ok: false, error: 'identificacao_obrigatoria' }
  }

  return { ok: true, value: { requestType, sourceUrl, displayName, message, contactEmail } }
}

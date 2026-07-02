import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { normalizeTakedownIntake, type TakedownIntakeInput } from '@/domain/takedown'
import { createTakedownTicket } from '@/server/legal/takedown-intake'

/**
 * Intake PÚBLICO de pedidos do titular / takedown (issue #399, GAP-2; `docs/legal/takedown-e-remocao-
 * titular.md` §2). POST `{ requestType, sourceUrl?, displayName?, message, contactEmail? }` →
 * `{ ticketId }` (201): abre um ticket (início do SLA de 15 dias) e grava `DSAR_RECEIVED` na mesma
 * transação (via `createTakedownTicket`).
 *
 * SEM SESSÃO (cookie-free): o titular B (autor externo) NÃO tem conta — o formulário é aberto a
 * qualquer pessoa. Não lê cookie, nunca 401. É uma ESCRITA (não cacheável).
 *
 * Anti-500 (espelha `/api/search/cooks`): a validação/sanitização vive no domínio
 * (`normalizeTakedownIntake` — strip C0, trim, cortes, campos obrigatórios). Corpo malformado →
 * `request.json()` cai em `{}` → 400 `dados_invalidos`. Um erro inesperado (soluço de DB) é capturado e
 * responde 500 com chave GENÉRICA `erro` — NUNCA vaza SQL/stack e o handler nunca lança sem tratamento.
 * Não degradamos para "sucesso falso": num INSERT, fingir 201 sem gravar seria mentir para o titular.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as TakedownIntakeInput
  const parsed = normalizeTakedownIntake(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  const locale = parseRequestLocale(request)

  try {
    const { ticketId } = await createTakedownTicket(getDb(), { ...parsed.value, locale })
    return Response.json({ ticketId }, { status: 201 })
  } catch {
    // Não vaza detalhe do erro; o cliente mostra uma mensagem genérica de "tente novamente".
    return Response.json({ error: 'erro' }, { status: 500 })
  }
}

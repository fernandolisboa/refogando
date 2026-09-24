import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { eraseOwnAccount } from '@/server/legal/account-erasure'

/**
 * POST /api/me/erasure — ELIMINAÇÃO self-service da PRÓPRIA conta (issue #401, GAP-6; LGPD Art. 18 VI
 * + Art. 16; `docs/legal/takedown-e-remocao-titular.md` §6/§8).
 *
 * Owner-only via `requireSession` (ADR-0011): 401 = Visitante ou conta já soft-deletada. SEM
 * parâmetro de caminho / id do cliente ⇒ nenhuma superfície de IDOR — elimina SEMPRE o
 * `session.user.id`.
 *
 * Confirmação OBRIGATÓRIA (`{ "confirm": true }`): guarda contra disparo acidental de uma ação
 * consequente e (com o cookie SameSite do Better Auth) contra CSRF. Corpo ausente/`confirm` != true
 * → 400 confirmacao_necessaria, ZERO efeito colateral.
 *
 * Efeito (CONSERVADOR — ver `eraseOwnAccount`): anonimiza a PII + bloqueia (`deletedAt`) + carimba
 * (`anonymizedAt`) + desloga (apaga sessões) + remove credenciais (apaga `account`) + audita. O
 * conteúdo do titular é MANTIDO (anonimizado). Idempotente: 2ª chamada com a mesma sessão já cai no
 * 401 conta_desativada do guard.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown }
  if (body.confirm !== true) {
    return Response.json({ error: 'confirmacao_necessaria' }, { status: 400 })
  }

  const result = await eraseOwnAccount(getDb(), { userId: g.session.user.id })
  if (result.kind === 'not_found') {
    // Corrida improvável: a linha sumiu entre o guard e o UPDATE. Trata como já-eliminada (leak-safe).
    return Response.json({ ok: true, alreadyErased: true }, { status: 200 })
  }
  return Response.json(
    { ok: true, alreadyErased: result.kind === 'already_erased' },
    { status: 200 },
  )
}

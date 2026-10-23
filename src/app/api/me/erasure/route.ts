import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { eraseOwnAccount } from '@/server/legal/account-erasure'

/**
 * POST /api/me/erasure — ELIMINAÇÃO self-service da PRÓPRIA conta (issue #401, GAP-6; #473, ADR-0050;
 * LGPD Art. 18, VI; arts. 15, III e 16; `docs/legal/takedown-e-remocao-titular.md` §6/§8).
 *
 * Owner-only via `requireSession` (ADR-0011): 401 = Visitante ou conta já soft-deletada. SEM
 * parâmetro de caminho / id do cliente ⇒ nenhuma superfície de IDOR — elimina SEMPRE o
 * `session.user.id`.
 *
 * Confirmação OBRIGATÓRIA (`{ "confirm": true }`): guarda contra disparo acidental de uma ação
 * consequente e (com o cookie SameSite do Better Auth) contra CSRF. Corpo ausente/`confirm` != true
 * → 400 confirmacao_necessaria, ZERO efeito colateral.
 *
 * Efeito (ver `eraseOwnAccount`): anonimiza a PII + bloqueia (`deletedAt`) + carimba (`anonymizedAt`) +
 * desloga (apaga sessões) + remove credenciais (apaga `account` e os tokens de `verification`) + APAGA o
 * conteúdo PRIVADO (Receitas privadas, imagens, coleções, saves, listas, follows, notificações, Plano de
 * refeições (Cardápio), Despensa) e limpa as sessões de criação + audita, tudo numa transação. FICAM,
 * anonimizadas, as Receitas públicas, as avaliações e as denúncias registradas. Os blobs saem depois do
 * commit. Idempotente: como todas as sessões foram apagadas, a 2ª chamada com o mesmo cookie cai no 401
 * `nao_autenticado` do guard.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
// Folga para a conta com muitas Receitas privadas: a transação e as deleções de blob depois do commit.
export const maxDuration = 60

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

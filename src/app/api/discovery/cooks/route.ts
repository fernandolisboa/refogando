import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { RECOMMENDED_COOKS_LIMIT } from '@/domain/recommended-cooks-read'

/**
 * Trilho "Cozinheiros pra seguir" (#278, ADR-0024): GET → `{ cooks }`, os Cozinheiros recomendados por
 * POPULARIDADE GLOBAL (votos+favoritos de terceiros), EXCLUINDO o próprio viewer e quem ele já segue.
 *
 * SÓ-LOGADO (v1, espelha `/api/feed/following`): `requireSession` ANTES do DB ⇒ Visitante/conta-
 * desativada = 401, zero efeito. As exclusões (self + já-seguidos) são conceitos de viewer logado; a
 * variante anônima/global (loader já a suporta com `viewerId` undefined) fica DEFERIDA. Como ilha
 * cliente que renderiza nada no SSR, a home anon/indexável segue byte-idêntica (Modelo B).
 *
 * `viewerId` é SEMPRE `session.user.id` (NUNCA lido de query/body): senão um logado passaria o id de
 * outro e leria as recomendações dele — que codificam indiretamente o grafo de quem ele segue (IDOR).
 *
 * `Cache-Control: no-store` (espelha o GET de `/api/feed/following` e `/api/u/<handle>/follow`): a
 * resposta é per-viewer (exclui o grafo de seguir do viewer) e NUNCA pode ser edge-cacheada como
 * resposta compartilhada.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id // HARD-WIRED da sessão — nunca de query/body (anti-IDOR).

  const cooks = await loadRecommendedCooks(getDb(), { viewerId, limit: RECOMMENDED_COOKS_LIMIT })
  return Response.json({ cooks }, { headers: { 'cache-control': 'no-store' } })
}

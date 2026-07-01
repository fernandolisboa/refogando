import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { RECOMMENDED_COOKS_LIMIT } from '@/domain/recommended-cooks-read'
import { resolveLocale } from '@/i18n/locale'

/**
 * Trilho "Cozinheiros em alta" (#278, ADR-0024 emendado): GET → `{ cooks }`, os Cozinheiros recomendados
 * por POPULARIDADE GLOBAL (votos+saves de terceiros), EXCLUINDO o próprio viewer e quem ele já segue.
 * Cada cartão traz um preview (≤3) das receitas do Cozinheiro.
 *
 * SÓ-LOGADO (v1, espelha `/api/feed/following`): `requireSession` ANTES do DB ⇒ Visitante/conta-
 * desativada = 401, zero efeito. As exclusões (self + já-seguidos) são conceitos de viewer logado; a
 * variante anônima/global (loader já a suporta com `viewerId` undefined) fica DEFERIDA. Como ilha
 * cliente que renderiza nada no SSR, a home anon/indexável segue byte-idêntica (Modelo B).
 *
 * `viewerId` é SEMPRE `session.user.id` (NUNCA lido de query/body): senão um logado passaria o id de
 * outro e leria as recomendações dele — que codificam indiretamente o grafo de quem ele segue (IDOR).
 *
 * `locale` (ADR-0024 emendado): o preview de receitas traz títulos LOCALIZADOS (mesma regra do feed), então
 * o cliente passa `?locale=`. `resolveLocale` é permissivo (canoniza 'pt-br'→'pt-BR', desconhecido→default;
 * nunca 400/500). NÃO afeta o ranking nem as exclusões (locale-independentes).
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
  const requestLocale = resolveLocale({
    preferred: new URL(request.url).searchParams.get('locale'),
  })

  // #308: `loadRecommendedCooks` agora pagina ⇒ retorna `{ cooks, nextCursor }`. O trilho (#278) é
  // top-N sem paginação, então ignora `nextCursor` e não passa cozinha/cursor (defaults = sem filtro).
  const { cooks } = await loadRecommendedCooks(getDb(), {
    viewerId,
    limit: RECOMMENDED_COOKS_LIMIT,
    requestLocale,
  })
  return Response.json({ cooks }, { headers: { 'cache-control': 'no-store' } })
}

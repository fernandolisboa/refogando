import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { COOKS_DIRECTORY_PAGE_SIZE } from '@/domain/recommended-cooks-read'
import { resolveLocale } from '@/i18n/locale'
import { parseCozinhasParam } from '@/domain/search-terms'
import { decodeRecsCursor } from '@/domain/cooks-cursor'

/**
 * Lista da Descoberta de Cozinheiros (#308, `/cooks`) — recomendações por popularidade GLOBAL, com filtro
 * de Cozinha e paginação keyset. GET `?cozinha=&cursor=&locale=` → `{ cooks, nextCursor }`. Distinta do
 * trilho `/api/discovery/cooks` (#278, top-N só-logado): este é o diretório navegável (página maior, anon).
 *
 * SESSÃO OPCIONAL (idiom de `/api/feed`): logado → PERSONALIZADO (exclui você + já-seguidos); anônimo →
 * GLOBAL. `viewerId` vem SEMPRE da sessão (anti-IDOR — NUNCA de query/body; senão um logado leria as
 * recomendações de outro, que codificam o grafo de quem ele segue). Conta desativada/Visitante = `undefined`
 * ⇒ ramo global (conteúdo público, benigno).
 *
 * `Cache-Control: no-store` SEMPRE: a resposta LOGADA é per-viewer e a chave de cache da Vercel é a URL
 * (não o cookie) — cachear aqui serviria o corpo GLOBAL a um logado (personalização quebrada). A página
 * `/cooks` já é cacheável pelo seu SSR GLOBAL (Modelo B); a personalização é re-buscada por AQUI no cliente
 * quando logado. NÃO assistivo (≠ /api/search/cooks): é o conteúdo principal — erro REAL de DB deve 500
 * (só o input de URL — cursor/cozinha forjados — é que nunca vira 500, já hardened no codec/parser).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const g = await requireSession(request)
  // Sessão OPCIONAL: logado ⇒ personalizado; senão ⇒ global. SEMPRE da sessão (anti-IDOR).
  const viewerId = g.ok ? g.session.user.id : undefined
  const requestLocale = resolveLocale({ preferred: url.searchParams.get('locale') })
  const cozinhas = parseCozinhasParam(url.searchParams.get('cozinha'))
  const cursor = decodeRecsCursor(url.searchParams.get('cursor'))

  const { cooks, nextCursor } = await loadRecommendedCooks(getDb(), {
    viewerId,
    limit: COOKS_DIRECTORY_PAGE_SIZE,
    requestLocale,
    cozinhas,
    cursor,
  })
  return Response.json({ cooks, nextCursor }, { headers: { 'cache-control': 'no-store' } })
}

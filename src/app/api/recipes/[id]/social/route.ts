import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { loadViewerSocialState } from '@/server/recipe/social'

/**
 * Estado social do PRÓPRIO viewer — `GET /api/recipes/[id]/social` → `{ viewerSaved, isOwner }`.
 * EXISTE porque o caminho PÚBLICO/cacheável do detalhe (#230, ADR-0020) lê ANÔNIMO (sem cookie) e
 * não personaliza, então não entrega o estado do viewer; os `RecipeEngagementControls` (client)
 * batem aqui quando logado pra hidratar o save real em vez do convite "Entrar para...".
 *
 * Route FINO: uuid inválido → 404; SESSÃO (não papel) → 401 ANTES do DB (anônimo = zero efeito);
 * gate de SALVAR LEAK-SAFE → 404 (privada de outro não vaza existência; a própria privada do dono
 * hidrata, #362). `viewerSaved` é SEMPRE do ator autenticado (`session.user.id` HARD-WIRED, nunca de
 * query/body) — nunca vaza estado alheio (anti-IDOR). `Cache-Control: no-store`: resposta per-viewer,
 * nunca edge-cacheável como resposta compartilhada (espelha `/api/discovery/cooks`).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: anônimo ⇒ 401 (o cliente nem chega aqui sem sessão, mas é defesa em
  // profundidade + consistência com as rotas de save).
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await loadViewerSocialState({ db: getDb(), id, userId: g.session.user.id })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json(
    { viewerSaved: res.viewerSaved, isOwner: res.isOwner },
    { headers: { 'cache-control': 'no-store' } },
  )
}

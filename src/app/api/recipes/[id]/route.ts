import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeRows, loadSocialState } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'

/**
 * Leitura localizada da Receita (issue #3). Route fino: carrega a espinha +
 * traduções + ingredientes + tags via `loadRecipeRows` (loader de servidor
 * compartilhado — DRY com a retomada da #8) e delega a montagem da view ao módulo
 * PURO `resolveRecipeView` (sem DB). `?locale` escolhe o idioma pedido (padrão
 * DEFAULT_LOCALE). SOMENTE leitura — sem write/edit aqui.
 *
 * Gating de leitura (ADR-0011): catálogo/sistema (owner_id NULL) e Receitas `public`
 * são legíveis por qualquer um (sem auth — preserva os testes da #3). Receita com
 * dono + `private` (cobre toda geração da #8 e as playful) só é legível pelo próprio
 * dono; sem sessão OU dono diferente → 404 not_found (NÃO 401/403 — não vaza
 * existência).
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador (moderation_removed_at) sai
 * da leitura pública (anônimo/não-dono → 404), SEM tocar `visibility` — o Owner CONTINUA
 * dono da linha privada (lê/gerencia a própria, sem voteCount). Remover-do-pool ≠
 * despublicar; as duas dimensões são ortogonais (ver recipe-pool.ts).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const db = getDb()

  // Gating barato ANTES de carregar a view: lê só owner_id + visibility. Receita
  // ausente cai no mesmo not_found (malformado/ausente/sem-acesso indistinguíveis).
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      // #18: removida do pool pela moderação sai da leitura pública (não-dono → 404).
      moderationRemovedAt: recipe.moderationRemovedAt,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })

  // Pública/catálogo (owner_id NULL = sistema, ADR-0011) → legível por qualquer um.
  // Caso contrário (com dono + private) exige ser o próprio dono; senão 404 (não vaza
  // existência — mesma forma da rota de retomada em creation-sessions/[id]).
  //
  // #18: uma Receita removida do pool NÃO é leitura pública (isPublicRead=false) — anônimo/
  // não-dono cai no ramo privado → 404 (não vaza). O Owner da própria removida cai no ramo
  // privado, confirma ownership e lê a linha privada (200, SEM voteCount — fora do pool).
  // Remover-do-pool NÃO toca `visibility` (≠ despublicar, AC3).
  //
  // `viewerId` (#59) habilita os campos de gestão (`canManage`/`visibility`/`resultKind`)
  // quando o requester é o dono — NUNCA altera corpo/gate de leitura. Resolvido com
  // parcimônia: nunca lemos a sessão no tráfego anônimo quente (a Busca linka direto pra cá).
  const isPublicRead =
    (gate.ownerId == null || gate.visibility === 'public') && gate.moderationRemovedAt == null
  const requestLocale = parseRequestLocale(request)

  let viewerId: string | undefined
  let rows: Awaited<ReturnType<typeof loadRecipeRows>>
  if (!isPublicRead) {
    // Ramo privado: a sessão GATEIA se vale carregar — só pagamos `loadRecipeRows` depois
    // de confirmar que o requester é o dono (sequencial de propósito: não carregar sem acesso).
    const g = await requireSession(request)
    if (!g.ok || g.session.user.id !== gate.ownerId) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    viewerId = g.session.user.id
    rows = await loadRecipeRows(db, id)
  } else if (request.headers.get('cookie') != null) {
    // Ramo público COM cookie (com OU sem dono — #16): só vale descobrir o requester quando
    // há cookie (pula o anônimo puro — perf). Antes (#59) este ramo exigia `ownerId != null`,
    // o que NUNCA resolvia o viewerId no Catálogo (ownerId NULL); mas Catálogo É
    // votável/favoritável (#16), então um logado que favoritou no Catálogo precisa ver
    // `viewerFavorited` no detalhe. Resolver a sessão sempre que houver cookie corrige isso.
    // Lê só `g.ok`/`g.session`; JAMAIS `g.response` (leitura pública permanece
    // anônima-friendly, nunca vira 401/404 aqui). A sessão NÃO gateia a carga ⇒ sobrepomos
    // `requireSession` e `loadRecipeRows` (colapsa o round-trip serial do logado quente).
    const [g, loaded] = await Promise.all([requireSession(request), loadRecipeRows(db, id)])
    if (g.ok) viewerId = g.session.user.id
    rows = loaded
  } else {
    // Ramo público anônimo (sem cookie) ou catálogo anônimo: nenhuma sessão a resolver.
    rows = await loadRecipeRows(db, id)
  }
  if (!rows) return Response.json({ error: 'not_found' }, { status: 404 })

  // Estado social (#16): `voteCount` SÓ no pool (isPublicRead) — omitido em owned-private;
  // `viewerVoted`/`viewerFavorited` SÓ quando há viewerId. Junto ao caminho já paralelo.
  const social = await loadSocialState(db, { id, viewerId, includeVoteCount: isPublicRead })

  const view = resolveRecipeView({
    ...rows,
    requestLocale,
    viewerId,
    voteCount: social.voteCount,
    viewerVoted: social.viewerVoted,
    viewerFavorited: social.viewerFavorited,
  })

  return Response.json(view)
}

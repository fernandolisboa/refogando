import { eq, asc, desc } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { creationSession, generation, transcriptMessage } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeRows } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'

/**
 * Retomada de Session (issue #8, §7b; ADR-0010 route handler; estendida em #15).
 *
 * GET devolve a Session do próprio Usuário com a sua Receita atual (se houver), a
 * Transcrição durável (#15) e o Comentário consultivo. requireSession (própria sessão);
 * 404 quando a Session não existe OU `userId` != dono — NÃO vaza a existência. Se
 * `recipe_id` é NULL (ex. impossible OU antes da 1ª destilação) → `recipe:null`. Se há
 * Receita: carrega via `loadRecipeRows` + `resolveRecipeView` e devolve a view SEM erro
 * mesmo se `recipe.schema_version` < SCHEMA_VERSION_RECEITA (sem migração, sem rejeição —
 * a leitura NÃO ramifica por schema_version).
 *
 * `transcript`: as falas (`transcript_message`) ordenadas por `seq` — retomada continua de
 * onde parou, em ordem e por inteiro. `advisory`: o `advisory_comment` da generation MAIS
 * RECENTE (ou null antes da 1ª destilação / após apagar a Transcrição). A resposta é sempre
 * `{session, recipe, transcript, advisory}`.
 *
 * `?locale` escolhe o idioma pedido (padrão DEFAULT_LOCALE), igual à leitura da #3.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const db = getDb()
  const [sessionRow] = await db.select().from(creationSession).where(eq(creationSession.id, id))

  // Não existe OU não é do próprio Usuário → 404 (não vaza existência).
  if (!sessionRow || sessionRow.userId !== g.session.user.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const session = {
    id: sessionRow.id,
    mode: sessionRow.mode,
    recipeId: sessionRow.recipeId,
    createdAt: sessionRow.createdAt,
    updatedAt: sessionRow.updatedAt,
  }

  // Transcrição durável (#15): as falas ordenadas por seq — em ordem e por inteiro.
  const messages = await db
    .select({ role: transcriptMessage.role, content: transcriptMessage.content, seq: transcriptMessage.seq })
    .from(transcriptMessage)
    .where(eq(transcriptMessage.creationSessionId, id))
    .orderBy(asc(transcriptMessage.seq))
  const transcript = messages.map((m) => ({ role: m.role, content: m.content, seq: m.seq }))

  // Comentário consultivo da generation MAIS RECENTE (null antes da 1ª destilação OU após
  // apagar a Transcrição, que zera advisory_comment de todas as generation da Session).
  const [latestGen] = await db
    .select({ advisory: generation.advisoryComment })
    .from(generation)
    .where(eq(generation.creationSessionId, id))
    .orderBy(desc(generation.createdAt))
    .limit(1)
  const advisory = latestGen?.advisory ?? null

  if (sessionRow.recipeId == null) {
    return Response.json({ session, recipe: null, transcript, advisory })
  }

  const requestLocale = parseRequestLocale(req)

  // Carrega a Receita atual e devolve a view SEM ramificar por schema_version
  // (retoma a Receita atual como está — sem migração, sem erro).
  const rows = await loadRecipeRows(db, sessionRow.recipeId)
  if (!rows) return Response.json({ session, recipe: null, transcript, advisory })

  const recipe = resolveRecipeView({ ...rows, requestLocale })
  return Response.json({ session, recipe, transcript, advisory })
}

import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { creationSession } from '@/db/schema'

/**
 * Início da Session de conversa (issue #15, ADR-0006/0009).
 *
 * POST cria a `creation_session` no COMEÇO da conversa (mode='conversation', recipe_id NULL),
 * ANTES de qualquer destilação — assim a Transcrição persiste à medida que cresce e o Usuário
 * pode RETOMAR antes de existir Receita (AC: fechar & retomar). A Receita se anexa depois, via
 * o caminho `existingSessionId` de `persistGeneration` (UPDATE de recipe_id).
 *
 * requireSession FAIL-CLOSED: 401 sem Usuário logado (conversa exige Usuário; Anônimo-efêmero
 * é #22, fora de escopo). Retorna `{sessionId}` — só o id; o corpo da Session se lê no GET.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const [session] = await getDb()
    .insert(creationSession)
    .values({ userId: g.session.user.id, mode: 'conversation', recipeId: null })
    .returning({ id: creationSession.id })

  return Response.json({ sessionId: session.id }, { status: 201 })
}

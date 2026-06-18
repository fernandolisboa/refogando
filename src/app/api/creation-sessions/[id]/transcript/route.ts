import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { creationSession, generation, transcriptMessage } from '@/db/schema'
import { isUuid } from '@/server/http/params'

/**
 * Apagar a Transcrição da Session (issue #15, IRREVERSÍVEL).
 *
 * DELETE remove as falas (`transcript_message`) E zera o Comentário consultivo de TODAS as
 * `generation` da Session — MANTENDO a Receita (a confirmação na UI é a #60). O `result_kind`
 * (ex.: degraded) segue na Receita; `generation.outcome`/`model` ficam intactos.
 *
 * requireSession + posse-ou-404 (espelha o GET de [id]): 404 quando a Session não existe OU
 * `userId` != dono — NÃO vaza existência. Tudo numa ÚNICA transação:
 *  1. DELETE transcript_message WHERE creation_session_id = id
 *  2. UPDATE generation SET advisory_comment = NULL WHERE creation_session_id = id (SESSION-
 *     SCOPED — pode haver MÚLTIPLAS generation por Session, ex. re-destilação).
 * Idempotente: um 2º DELETE devolve o mesmo status e não muda nada (zero linhas afetadas).
 * NÃO toca recipe / recipe_translation / recipe_ingredient / result_kind / outcome / model.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const db = getDb()
  const [sessionRow] = await db.select().from(creationSession).where(eq(creationSession.id, id))

  // Não existe OU não é do próprio Usuário → 404 (não vaza existência; espelha o GET de [id]).
  if (!sessionRow || sessionRow.userId !== g.session.user.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Posse já provada acima → o id é seguro como filtro DB. Uma transação: falas E advisory.
  await db.transaction(async (tx) => {
    await tx.delete(transcriptMessage).where(eq(transcriptMessage.creationSessionId, id))
    await tx
      .update(generation)
      .set({ advisoryComment: null })
      .where(eq(generation.creationSessionId, id))
  })

  return Response.json({ ok: true }, { status: 200 })
}

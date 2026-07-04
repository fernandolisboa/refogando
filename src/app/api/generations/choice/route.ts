import { and, eq, isNotNull } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { generation, creationSession } from '@/db/schema'
import { isUuid } from '@/server/http/params'

/**
 * Escolha da variação — "gerar 2, o usuário escolhe" (issue #423, ADR-0029 dec.6).
 *
 * POST registra `variant_chosen` na geração ESCOLHIDA de um lote (`variant_group_id`). A escolha é
 * SERVER-AUTHORITATIVE e ESCOPADA POR OWNER (fail-closed, espelha `assertOwnedSession` do persist.ts):
 * NUNCA confia num `generationId` arbitrário do body sem provar posse. A prova é o JOIN
 * generation⋈creation_session filtrado por `creation_session.user_id === ownerId` — uma geração de
 * outro dono (ou inexistente) devolve 404 leak-safe (não-403), sem tocar linha alheia.
 *
 * Só gerações de VARIAÇÃO (variant_group_id NOT NULL) são escolhíveis — uma geração single não tem
 * grupo. Numa transação: marca a escolhida `true` e as IRMÃS do mesmo grupo `false`, então o sinal é
 * limpo (exatamente UMA escolhida por grupo) e idempotente se o usuário reescolher. Ambas as receitas
 * já nasceram PRIVADAS (persist.ts); a escolha NÃO publica nem apaga — só carimba o sinal comportamental
 * (qual pólo o usuário guardou), correlacionável com a versão de prompt (ADR-0029 dec.7).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as { generationId?: unknown }

  // generationId obrigatório + bem-formado. Malformado é indistinguível de inexistente p/ o cliente
  // (não toca a coluna uuid → evita 22P02) → mesma política not_found (leak-safe).
  if (typeof body.generationId !== 'string' || !isUuid(body.generationId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const generationId = body.generationId

  const chosen = await getDb().transaction(async (tx) => {
    // Prova de posse fail-closed: a geração pendura numa creation_session DESTE owner E é de variação
    // (variant_group_id NOT NULL). Senão → não encontrada (404 leak-safe, nunca 403 — ADR-0011).
    const [gen] = await tx
      .select({ groupId: generation.variantGroupId })
      .from(generation)
      .innerJoin(creationSession, eq(generation.creationSessionId, creationSession.id))
      .where(
        and(
          eq(generation.id, generationId),
          eq(creationSession.userId, ownerId),
          isNotNull(generation.variantGroupId),
        ),
      )
    if (!gen || gen.groupId == null) return false

    // Sinal limpo: zera o grupo inteiro e marca só a escolhida. `variant_group_id` é próprio do lote
    // (uuid), então este UPDATE por grupo não toca gerações de outro usuário (o grupo é do owner).
    await tx.update(generation).set({ variantChosen: false }).where(eq(generation.variantGroupId, gen.groupId))
    await tx.update(generation).set({ variantChosen: true }).where(eq(generation.id, generationId))
    return true
  })

  if (!chosen) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ ok: true }, { status: 200 })
}

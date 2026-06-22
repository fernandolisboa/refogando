import { and, eq, gte } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { creationSession, generation } from '@/db/schema'
import { RECIPE_GEN_WINDOW_MS } from '@/domain/recipe-gen-quota'

/**
 * Insumo do teto de geração de RECEITA (#167): os `created_at` das `generation` do usuário na janela
 * 24h deslizante. SEM ledger novo — conta os registros de geração JÁ persistidos: cada `generation`
 * pendura numa `creation_session` (que carrega o `user_id`), então um JOIN session→generation, filtrado
 * por `user_id` + janela, dá a contagem por usuário. Conta TODAS as tentativas (success|degraded|
 * playful|impossible): o custo (chamada ao Claude) já foi gasto em qualquer desfecho — espelha a
 * semântica de imagem, onde o slot consumido não é devolvido.
 *
 * Espelha `loadRecentAiGenAt` (server/recipe/image.ts), trocando o ledger imutável pelo par
 * generation⋈creation_session. cap ∞ (papel ilimitado) NÃO chega aqui — o caller pula a query.
 */
export async function loadRecentRecipeGenAt(
  db: Database,
  userId: string,
  now: Date,
): Promise<Date[]> {
  const since = new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)
  const rows = await db
    .select({ createdAt: generation.createdAt })
    .from(generation)
    .innerJoin(creationSession, eq(generation.creationSessionId, creationSession.id))
    .where(and(eq(creationSession.userId, userId), gte(generation.createdAt, since)))
  return rows.map((r) => r.createdAt)
}

import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe } from '@/db/schema'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { sourceNameIsHost } from '@/domain/source-host'
import { loadRecipeRows } from '@/server/recipe/load'
import { recordDsarEvent } from '@/server/legal/dsar-audit'

/**
 * Núcleo com efeito de REMOVER o nome da fonte de uma Receita importada (#272 LGPD, ADR-0019). Espelha
 * `applyVisibilityTransition`: gate barato → guard de ownership (404 leak-safe) → decisão → UPDATE só
 * quando muda → devolve a VIEW montada (mesma forma do GET) para a UI atualizar direto da resposta.
 *
 * LGPD "remover o nome": zera SÓ `source_name`; `source_url` FICA — a atribuição obrigatória (ADR-0019)
 * cai pro HOST da URL (e o link "ver no site" segue). Não-reversível pro nome (a URL ainda permite
 * re-derivar o host, nunca o nome original) — aceitável para o direito de remoção.
 *
 * Autorização é OWNERSHIP (não papel): catálogo (ownerId NULL) e dono diferente ⇒ `not_found` (404),
 * NUNCA 403 — não vaza existência (ADR-0011). Espelha o gate do GET/publish.
 */

/**
 * Núcleo PURO da decisão "há um nome de fonte HUMANO a remover desta Receita?" — fonte ÚNICA da regra,
 * reusada pelo self-service (`clearSourceAttribution`, abaixo) E pelo fluxo do operador/Encarregado
 * (`operatorClearSourceAttribution`, #396/GAP-4). Zerar `source_name` só faz sentido quando:
 *  - `origin === 'web_imported'` (só a importada carrega atribuição — ADR-0019); E
 *  - há `sourceUrl` (sem ele o botão se esconde — paridade exata botão↔servidor); E
 *  - o nome NÃO é apenas o host (`sourceNameIsHost` — a MESMA normalização das duas pontas).
 * Fora disso é no-op idempotente (nada a remover): não-importada, sem nome, ou nome que já é o host.
 */
export function hasRemovableSourceName(row: {
  origin: string
  sourceName: string | null
  sourceUrl: string | null
}): boolean {
  return (
    row.origin === 'web_imported' &&
    row.sourceUrl != null &&
    !sourceNameIsHost(row.sourceName, row.sourceUrl)
  )
}

export type ClearAttributionResult =
  | { kind: 'ok'; view: RecipeView } // 200 — view montada (limpou OU no-op idempotente)
  | { kind: 'not_found' } //            404 — inexistente / não-dono / catálogo

export async function clearSourceAttribution(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  requestLocale: string
}): Promise<ClearAttributionResult> {
  const { db, id, userId, requestLocale } = input

  // 1. Gate barato: só o necessário p/ decidir.
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      origin: recipe.origin,
      sourceName: recipe.sourceName,
      sourceUrl: recipe.sourceUrl,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return { kind: 'not_found' } // inexistente

  // 2. Ownership: catálogo (ownerId NULL) ⇒ nunca é dono ⇒ 404; dono diferente ⇒ 404 (nunca 403).
  if (gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // 3. Limpa SÓ se é importada com um nome HUMANO (≠ host). Senão é no-op idempotente: nada a remover
  //    (não-importada, sem nome, ou nome que já é o host) ⇒ 200 sem UPDATE redundante nem bump de
  //    updatedAt. A decisão é o núcleo PURO `hasRemovableSourceName` — MESMA regra/normalização do botão
  //    e do fluxo do operador (#396), não duplicada aqui.
  if (hasRemovableSourceName(gate)) {
    // O nome a remover é humano (≠ host) ⇒ non-null aqui (sourceNameIsHost(null,·) === true excluiria).
    const removedSourceName = gate.sourceName as string
    const ts = new Date()
    // Remoção EFETIVA + auditoria DSAR na MESMA transação (GAP-5, #395): ou remove-e-audita, ou nada —
    // nunca zera o nome sem deixar a trilha append-only. O `DSAR_FULFILLED` grava só o HASH do que mudou
    // ({ recipeIds, removedSourceName, ts }); o nome NUNCA vai em claro (senão a auditoria copia o dado
    // que se pediu para apagar). No-op idempotente NÃO entra aqui ⇒ não gera evento espúrio.
    await db.transaction(async (tx) => {
      await tx
        .update(recipe)
        .set({ sourceName: null, updatedAt: ts }) // SÓ sourceName; NUNCA toca origin/sourceUrl
        .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId))) // autoriza também na escrita
      await recordDsarEvent(tx, {
        eventType: 'DSAR_FULFILLED',
        actorId: userId, // self-service: o dono acionou a remoção do próprio nome de fonte
        channel: 'self_service',
        requestType: 'name_removal',
        fulfillment: { recipeIds: [id], removedSourceName, ts: ts.toISOString() },
        details: { recipeIds: [id] }, // ids internos (não-sensíveis); o nome só existe no hash
      })
    })
  }

  // 4. Monta a view atualizada (mesma forma/locale do GET) — a UI seta o estado da resposta + refresh.
  const rows = await loadRecipeRows(db, id)
  if (!rows) return { kind: 'not_found' } // corrida improvável; mantém o contrato
  const view = resolveRecipeView({ ...rows, requestLocale, viewerId: userId })
  return { kind: 'ok', view }
}

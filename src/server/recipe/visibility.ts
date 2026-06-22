import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe } from '@/db/schema'
import type { Visibility } from '@/domain/recipe'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { decideVisibilityTransition } from '@/domain/recipe-visibility'
import { loadRecipeRows } from '@/server/recipe/load'

/**
 * Núcleo com efeito da transição de Visibilidade (issue #13, §2.2), compartilhado
 * por `publish` e `unpublish`. Concentra TODO o trabalho com efeito (gate barato,
 * guard de ownership, decisão pura, UPDATE condicional, captura de 23514/P0001) e
 * devolve um discriminated union que o route mapeia para HTTP — rotas finas e DRY.
 *
 * No sucesso devolve a VIEW já montada (mesma forma do GET), porque tanto o caminho
 * com UPDATE quanto o no-op precisam responder "a view da receita atualizada". O
 * route só passa o `requestLocale` (já parseado) e mapeia o discriminator.
 *
 * Autorização é OWNERSHIP (não papel): catálogo (ownerId NULL) e dono diferente ⇒
 * `not_found` (404), NUNCA 403 — não vaza existência (ADR-0011). Espelha o gate do GET.
 */

export type VisibilityChangeResult =
  | { kind: 'ok'; view: RecipeView } // 200 — view montada (mudou OU no-op)
  | { kind: 'not_found' } //            404 — inexistente / não-dono / catálogo
  | { kind: 'playful' } //              422 — playful_nao_publicavel
  | { kind: 'web_imported' } //         422 — web_imported_nao_publicavel (ADR-0019/#168)

/**
 * Lê o SQLSTATE de um erro do Postgres. Sob Drizzle/postgres.js o `PostgresError`
 * chega embrulhado em `err.cause`; lemos `err.cause.code` E `err.code` (fallback
 * defensivo) e devolvemos o primeiro definido — rede caso o embrulho mude. Provado
 * contra o Postgres real no micro-spike de §4 antes de confiar no catch.
 */
export function pgCode(err: unknown): string | undefined {
  const causeCode = (err as { cause?: { code?: unknown } } | null)?.cause?.code
  if (typeof causeCode === 'string') return causeCode
  const topCode = (err as { code?: unknown } | null)?.code
  if (typeof topCode === 'string') return topCode
  return undefined
}

export async function applyVisibilityTransition(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  target: Visibility // 'public' (publish) | 'private' (unpublish)
  requestLocale: string
}): Promise<VisibilityChangeResult> {
  const { db, id, userId, target, requestLocale } = input

  // 1. Gate barato: lê só o necessário p/ decidir (espelha o GET).
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      origin: recipe.origin, // #168: a decisão precisa do origin p/ barrar web_imported→public.
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return { kind: 'not_found' } // inexistente

  // 2. Ownership: catálogo (ownerId NULL) ⇒ usuário nunca é dono ⇒ 404; dono
  //    diferente ⇒ 404 (mesma forma do GET; nunca 403, não vaza existência).
  if (gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // 3. Decisão pura.
  const decision = decideVisibilityTransition({
    origin: gate.origin,
    resultKind: gate.resultKind,
    current: gate.visibility,
    target,
  })
  if (!decision.allowed) {
    return decision.reason === 'web_imported_nao_publicavel'
      ? { kind: 'web_imported' }
      : { kind: 'playful' }
  }

  // 4. UPDATE só quando muda (idempotência sem UPDATE redundante nem bump de updatedAt).
  if (decision.changed) {
    try {
      await db
        .update(recipe)
        .set({ visibility: target, updatedAt: new Date() }) // NUNCA toca origin
        .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId))) // E5: autoriza também na escrita
    } catch (e) {
      // Defense-in-depth: a app já barrou playful/ownership; isto é rede de segurança.
      const code = pgCode(e)
      if (code === '23514') return { kind: 'playful' } // CHECK recipe_playful_private_chk
      // P0001 (origin imutável) NÃO deve ocorrer aqui (nunca setamos origin) —
      // relança p/ não mascarar bug interno (500 honesto). Qualquer outro: relança.
      throw e
    }
  }

  // 5. Monta a view atualizada (mesma forma do GET, mesmo locale). `viewerId: userId`
  //    (sempre o dono neste ponto) ⇒ a resposta JÁ traz canManage/visibility/resultKind
  //    atualizados, então a UI seta o estado direto da resposta + router.refresh() (#59).
  const rows = await loadRecipeRows(db, id)
  if (!rows) return { kind: 'not_found' } // corrida improvável; mantém o contrato
  const view = resolveRecipeView({ ...rows, requestLocale, viewerId: userId })
  return { kind: 'ok', view }
}

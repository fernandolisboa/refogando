import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { creationSession } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeRows } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'

/**
 * Retomada de Session (issue #8, §7b; ADR-0010 route handler).
 *
 * GET devolve a Session do próprio Usuário com a sua Receita atual (se houver).
 * requireSession (própria sessão); 404 quando a Session não existe OU `userId` !=
 * dono — NÃO vaza a existência. Se `recipe_id` é NULL (ex. impossible) → `{session,
 * recipe:null}`. Se há Receita: carrega via `loadRecipeRows` + `resolveRecipeView`
 * e devolve a view SEM erro mesmo se `recipe.schema_version` < SCHEMA_VERSION_RECEITA
 * (sem migração, sem rejeição — a leitura NÃO ramifica por schema_version).
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

  if (sessionRow.recipeId == null) {
    return Response.json({ session, recipe: null })
  }

  const requestLocale = parseRequestLocale(req)

  // Carrega a Receita atual e devolve a view SEM ramificar por schema_version
  // (retoma a Receita atual como está — sem migração, sem erro).
  const rows = await loadRecipeRows(db, sessionRow.recipeId)
  if (!rows) return Response.json({ session, recipe: null })

  const recipe = resolveRecipeView({ ...rows, requestLocale })
  return Response.json({ session, recipe })
}

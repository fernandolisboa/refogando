import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { loadRecipeRows } from '@/server/recipe/load'
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
 * existência). Leitura moderada por papel (Curador/Admin) é #18, FORA de escopo.
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
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })

  // Pública/catálogo (owner_id NULL = sistema, ADR-0011) → legível por qualquer um.
  // Caso contrário (com dono + private) exige ser o próprio dono; senão 404 (não vaza
  // existência — mesma forma da rota de retomada em creation-sessions/[id]).
  const isPublicRead = gate.ownerId == null || gate.visibility === 'public'
  if (!isPublicRead) {
    const g = await requireSession(request)
    if (!g.ok || g.session.user.id !== gate.ownerId) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
  }

  const requestLocale = parseRequestLocale(request)

  const rows = await loadRecipeRows(db, id)
  if (!rows) return Response.json({ error: 'not_found' }, { status: 404 })

  const view = resolveRecipeView({ ...rows, requestLocale })

  return Response.json(view)
}

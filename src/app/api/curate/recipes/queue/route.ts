import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { listCatalogCurationQueue, listRejectedCatalog } from '@/server/curate/recipe-curation'

/**
 * Fila de CURADORIA de RECEITAS de catálogo (#238, ADR-0026) — `GET /api/curate/recipes/queue`.
 * Curador-only (`requireRole(req,'curador')`, fail-closed). Devolve os rascunhos `pending`/`editing`
 * (a fila ativa) + os `rejected` (tombstones, p/ rever/des-rejeitar). Leitura Curador-aware: mostra
 * rascunhos ESCONDIDOS do público (owner-null não-aprovado) sem leak — o gate de papel é a porta.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const db = getDb()
  const [queue, rejected] = await Promise.all([listCatalogCurationQueue(db), listRejectedCatalog(db)])
  return Response.json({ queue, rejected }, { status: 200, headers: { 'cache-control': 'no-store' } })
}

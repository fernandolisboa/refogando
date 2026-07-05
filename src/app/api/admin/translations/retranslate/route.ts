import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { retranslateOutdated } from '@/server/translation/retranslate'

/**
 * Re-tradução de defasadas (#499, ADR-0031 dec.5) — ADMIN-ONLY. Espelha
 * `/api/admin/embeddings/recompute` (#119): recomputa, em LOTE CAPADO, as traduções DERIVADAS
 * defasadas-e-intocadas. Idempotente e RETOMÁVEL: devolve `{ retranslated, degraded, remaining }` —
 * o admin chama de novo até `remaining === 0`. Degradação é POR LINHA (não pára o lote no 1º erro
 * do tradutor, ao contrário do backfill de embedding): cada Receita cuja tradução falha é pulada
 * (conta em `degraded`, permanece defasada) e o lote segue até `limit` candidatas.
 *
 * `?limit` controla o tamanho do lote (default 50, clamp [1, 200]) — mesmo teto do backfill de
 * embedding (serverless tem teto de tempo; o tradutor é rede/LLM).
 */

export const runtime = 'nodejs' // postgres-js + fetch (translator/embedder) exigem Node, não Edge.

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const raw = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT

  const result = await retranslateOutdated(getDb(), limit)
  return Response.json(result, { status: 200 })
}

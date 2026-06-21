import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recomputeMissingEmbeddings } from '@/server/embedding/recompute'

/**
 * BACKFILL de embeddings (#119) — ADMIN-ONLY. Recomputa, em LOTE CAPADO, as Traduções sem embedding
 * válido (receitas nascidas antes do pipeline de embedding-na-criação, ou cujo embed best-effort
 * falhou). Idempotente e RETOMÁVEL: devolve `{ recomputed, remaining, error? }` — o admin chama de
 * novo até `remaining === 0`. Para no 1º erro do embedder (ex. 429) reportando a causa, sem perder o
 * progresso. Requer a key de embedding no ambiente (gate humano, como a geração de imagem #132).
 *
 * `?limit` controla o tamanho do lote (default 50, clamp [1, 200]) — capado porque o serverless tem
 * teto de tempo e o embedder é rede.
 */

export const runtime = 'nodejs' // postgres-js + fetch (embedder) exigem Node, não Edge.

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const raw = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT

  const result = await recomputeMissingEmbeddings(getDb(), limit)
  return Response.json(result, { status: 200 })
}

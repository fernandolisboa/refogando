import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { rejectCozinha } from '@/server/vocabulary/curate'

/**
 * Curador REJEITA uma cozinha sugerida (#320). POST curador-only (`requireRole(req,'curador')`
 * VERBATIM → 401/403). `slug` = chave natural (decodeURIComponent). Corpo vazio `{}`. Anula
 * `recipe.cozinha` das receitas anexadas (sinal visível ao dono) e tomba a sugerida (`rejected`).
 * Devolve `{ ok:true }`.
 *
 * Corpo de erro `{ error:'<chave>' }` (literais de `curate.ts`). Mapa: nao_encontrado→404,
 * ja_resolvido→409.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: raw } = await params
  const slug = decodeURIComponent(raw)

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const res = await rejectCozinha(getDb(), { slug })

  if (res.ok) return Response.json({ ok: true }, { status: 200 })
  const status = res.error === 'nao_encontrado' ? 404 : 409
  return Response.json({ error: res.error }, { status })
}

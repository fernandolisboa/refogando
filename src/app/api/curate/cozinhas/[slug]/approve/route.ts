import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { approveCozinha } from '@/server/vocabulary/curate'

/**
 * Curador APROVA uma cozinha sugerida (#320). POST curador-only: `requireRole(req,'curador')`
 * (VERBATIM, fail-closed → 401/403). O `slug` é a CHAVE NATURAL (decodeURIComponent; NÃO uuid,
 * ao contrário de reports). Corpo `{ labelPtBr, labelEnUs, newSlug? }`; ambos os rótulos exigidos
 * (o Curador batiza a cozinha) + `newSlug?` para corrigir o slug canônico. Devolve `{ ok:true, slug }`.
 *
 * Corpo de erro sempre `{ error:'<chave>' }` com os literais EXATOS de `curate.ts` (a UI mapeia pela
 * CHAVE). Mapa de status: nao_encontrado→404, ja_resolvido→409, slug_em_uso→409, rotulos_invalidos/
 * slug_invalido→400. NÃO busta o cache de 30s de `loadVocabulary` (mesmo trade-off do /api/admin/*).
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

  const body = (await request.json().catch(() => ({}))) as {
    labelPtBr?: unknown
    labelEnUs?: unknown
    newSlug?: unknown
  }

  const res = await approveCozinha(getDb(), {
    slug,
    labelPtBr: typeof body.labelPtBr === 'string' ? body.labelPtBr : '',
    labelEnUs: typeof body.labelEnUs === 'string' ? body.labelEnUs : '',
    ...(typeof body.newSlug === 'string' ? { newSlug: body.newSlug } : {}),
  })

  if (res.ok) return Response.json({ ok: true, slug: res.slug }, { status: 200 })
  const status =
    res.error === 'nao_encontrado'
      ? 404
      : res.error === 'ja_resolvido' || res.error === 'slug_em_uso'
        ? 409
        : 400
  return Response.json({ error: res.error }, { status })
}

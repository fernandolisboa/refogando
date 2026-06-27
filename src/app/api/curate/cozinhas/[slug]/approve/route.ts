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
 *
 * Ordem de portaria: `requireRole` ANTES de `decodeURIComponent` (um `%` solto faz o decode lançar
 * URIError — não-autenticado não pode arrancar 500 antes do portão). Decode embrulhado → 404
 * nao_encontrado (slug é sempre [a-z0-9-]; malformado = inexistente). Chamada a `curate.ts`
 * embrulhada → `erro_interno` 500 sem stack (paridade com a rota de listagem).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const { slug: raw } = await params
  let slug: string
  try {
    slug = decodeURIComponent(raw)
  } catch {
    return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    labelPtBr?: unknown
    labelEnUs?: unknown
    newSlug?: unknown
  }

  try {
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
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
}

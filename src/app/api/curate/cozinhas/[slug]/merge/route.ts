import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { mergeCozinha } from '@/server/vocabulary/curate'

/**
 * Curador MESCLA uma cozinha sugerida numa cozinha ATIVA existente (#320). POST curador-only
 * (`requireRole(req,'curador')` VERBATIM → 401/403). `slug` = chave natural (decodeURIComponent).
 * Corpo `{ target }` (slug da cozinha ativa-alvo). Devolve `{ ok:true }`.
 *
 * Corpo de erro `{ error:'<chave>' }` (literais de `curate.ts`). Mapa: nao_encontrado→404,
 * ja_resolvido→409, alvo_invalido→400.
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

  const body = (await request.json().catch(() => ({}))) as { target?: unknown }

  const res = await mergeCozinha(getDb(), {
    slug,
    target: typeof body.target === 'string' ? body.target : '',
  })

  if (res.ok) return Response.json({ ok: true }, { status: 200 })
  const status = res.error === 'nao_encontrado' ? 404 : res.error === 'ja_resolvido' ? 409 : 400
  return Response.json({ error: res.error }, { status })
}

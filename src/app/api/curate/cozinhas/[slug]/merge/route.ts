import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { mergeCozinha } from '@/server/vocabulary/curate'

/**
 * Curador MESCLA uma cozinha sugerida numa cozinha ATIVA existente (#320). POST curador-only
 * (`requireRole(req,'curador')` VERBATIM → 401/403). `slug` = chave natural (decodeURIComponent).
 * Corpo `{ target }` (slug da cozinha ativa-alvo). Devolve `{ ok:true }`.
 *
 * Corpo de erro `{ error:'<chave>' }` (literais de `curate.ts`). Mapa: nao_encontrado→404,
 * ja_resolvido→409, alvo_invalido→400. `requireRole` ANTES do decode (URIError não-autenticado não
 * vira 500); decode malformado → 404; chamada embrulhada → `erro_interno` 500 (paridade c/ listagem).
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

  const body = (await request.json().catch(() => ({}))) as { target?: unknown }

  try {
    const res = await mergeCozinha(getDb(), {
      slug,
      target: typeof body.target === 'string' ? body.target : '',
    })

    if (res.ok) return Response.json({ ok: true }, { status: 200 })
    const status = res.error === 'nao_encontrado' ? 404 : res.error === 'ja_resolvido' ? 409 : 400
    return Response.json({ error: res.error }, { status })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
}

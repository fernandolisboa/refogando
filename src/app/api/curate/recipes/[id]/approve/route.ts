import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore, getImageGenerator } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { approveCatalogRecipe } from '@/server/curate/recipe-curation'

/**
 * APROVAR um rascunho de catálogo (#238, ADR-0026) — `POST /api/curate/recipes/[id]/approve`.
 * Curador-only. pending|editing → approved: vai ao público + promove o original_locale + embeda +
 * (emenda dec.12) AUTO-GERA imagem se faltar face não-moderada (best-effort, nunca bloqueia/desfaz a
 * aprovação). Valida uuid → 404; `requireRole` fail-closed; delega a `approveCatalogRecipe`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
// #238 (dec.12): a auto-gen na aprovação chama o Gemini (multi-segundo). Folga p/ a função não cortar
// no meio (a tx de estado já committou ANTES; o pior caso é a imagem não nascer — coberta pelo lote).
export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const res = await approveCatalogRecipe({
    db: getDb(),
    recipeId: id,
    curatorId: g.session.user.id,
    store: getImageStore(),
    generator: getImageGenerator(),
  })
  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_state':
      return Response.json({ error: 'estado_invalido' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

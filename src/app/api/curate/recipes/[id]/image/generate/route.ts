import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore, getImageGenerator } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyCatalogImageGeneration } from '@/server/curate/catalog-image'
import { IMAGE_PROMPT_OVERRIDE_MAX } from '@/domain/image-prompt'

/**
 * POST /api/curate/recipes/[id]/image/generate — gera imagem por IA p/ um rascunho de CATÁLOGO
 * (#238, ADR-0026 emenda dec.10/11). Curador-only; gate `origin='catalog'` (404 leak-safe). QUOTA-EXEMPT
 * (op administrativa) mas respeita o kill-switch global (#134) e ESCREVE no ledger (custo). AUTO-SELECIONA
 * a face (núcleo, tx única ⇒ sem cobrança dupla). Devolve a galeria atualizada (o estúdio re-renderiza
 * do retorno). `requireRole` ANTES de qualquer lookup (não vaza existência por status-code).
 */
export const runtime = 'nodejs' // postgres-js + Buffer + fetch exigem Node, não Edge.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  // Refino opcional (sufixo de estilo) — o núcleo SEMPRE ancora no prato; truncado por defesa (#214).
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown }
  const promptOverride =
    typeof body.prompt === 'string' ? body.prompt.slice(0, IMAGE_PROMPT_OVERRIDE_MAX) : undefined

  const res = await applyCatalogImageGeneration({
    db: getDb(),
    store: getImageStore(),
    generator: getImageGenerator(),
    id,
    curatorId: g.session.user.id,
    promptOverride,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ gallery: res.gallery }, { status: 200 })
    case 'disabled':
      return Response.json({ error: 'geracao_desabilitada' }, { status: 403 })
    case 'generator':
      return Response.json({ error: 'geracao_indisponivel' }, { status: 503 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

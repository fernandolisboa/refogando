import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore, getImageGenerator } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyRecipeImageGeneration } from '@/server/recipe/image'

/**
 * Geração de imagem por IA da Receita (#132, ADR-0017) — `POST /api/recipes/[id]/image/generate`.
 * Owner-only (catálogo/não-dono ⇒ 404, ADR-0011; o gate de dono vem ANTES de tocar o gerador, então
 * anon/não-dono NUNCA disparam o seam pago). Um-clique: monta o prompt da receita; aceita um
 * `prompt` editado opcional (refino). Reusa os seams `ImageGenerator` + `ImageStore` e a entidade
 * `recipe_image` (`ai_generated`, ref-counted). Teto por papel em janela 24h deslizante → 429 com
 * `retryAfterMs` (countdown). Degradação dos seams → 503 estruturado.
 */

export const runtime = 'nodejs' // postgres-js + Buffer + fetch exigem Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  // Prompt editado é OPCIONAL (refino); ausente ⇒ um-clique (a receita monta o prompt no núcleo).
  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown }
  const promptOverride = typeof body.prompt === 'string' ? body.prompt : undefined

  const res = await applyRecipeImageGeneration({
    db: getDb(),
    store: getImageStore(),
    generator: getImageGenerator(),
    id,
    userId: g.session.user.id,
    role: g.session.user.role,
    promptOverride,
    requestLocale: parseRequestLocale(request),
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'quota':
      return Response.json({ error: 'limite_geracao', retryAfterMs: res.retryAfterMs }, { status: 429 })
    case 'generator':
      return Response.json({ error: 'geracao_indisponivel' }, { status: 503 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

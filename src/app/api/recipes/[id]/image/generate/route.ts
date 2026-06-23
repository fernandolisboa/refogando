import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore, getImageGenerator } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyRecipeImageGeneration } from '@/server/recipe/image'
import { IMAGE_PROMPT_OVERRIDE_MAX } from '@/domain/image-prompt'

/**
 * Geração de imagem por IA da Receita = PREVIEW (#132/#222, ADR-0017/0022) —
 * `POST /api/recipes/[id]/image/generate`. Owner-only (catálogo/não-dono ⇒ 404, ADR-0011; o gate de
 * dono vem ANTES de tocar o gerador, então anon/não-dono NUNCA disparam o seam pago). Um-clique:
 * monta o prompt da receita; aceita um `prompt` editado opcional (refino, vira nota de estilo num
 * template estruturado, #223 — nunca substitui o prato). #222/#223: a geração ACRESCENTA uma
 * `recipe_image` DESELECIONADA à galeria da linhagem e devolve `{ image, basePrompt }` — a imagem
 * gerada + o prompt-base (pro modal exibir read-only); NÃO troca a face pública (a face só muda no
 * `POST .../select`). Teto por papel em janela 24h deslizante → 429 com `retryAfterMs` (countdown).
 * Degradação → 503.
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
  // Defesa-em-profundidade (#214): truncamos o override a IMAGE_PROMPT_OVERRIDE_MAX já aqui; o núcleo
  // (composeImagePrompt) também ancora SEMPRE no base da receita e re-limita — o servidor é a fonte
  // da verdade, o cliente não burla.
  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown }
  const promptOverride =
    typeof body.prompt === 'string' ? body.prompt.slice(0, IMAGE_PROMPT_OVERRIDE_MAX) : undefined

  const res = await applyRecipeImageGeneration({
    db: getDb(),
    store: getImageStore(),
    generator: getImageGenerator(),
    id,
    userId: g.session.user.id,
    role: g.session.user.role,
    promptOverride,
  })

  switch (res.kind) {
    case 'ok':
      // #222/#223: devolve a imagem-preview (deselecionada — a face não mudou) + o `basePrompt`
      // (prompt-base montado da receita, pro modal exibir read-only). O cliente nunca envia o base.
      return Response.json({ image: res.image, basePrompt: res.basePrompt }, { status: 200 })
    case 'disabled':
      // #134: geração desligada pelo admin (config). 403 — bloqueio explícito (a UI também esconde a ação).
      return Response.json({ error: 'geracao_desabilitada' }, { status: 403 })
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

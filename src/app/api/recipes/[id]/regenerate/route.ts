import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { DEFAULT_CLAUDE_MODEL } from '@/server/claude/client'
import { appConfig } from '@/db/schema'
import { isUuid } from '@/server/http/params'
import { regenerateRecipe } from '@/server/recipe/regenerate'

/**
 * POST /api/recipes/[id]/regenerate — REGENERA a PRÓPRIA Receita (issue #20): cria uma NOVA
 * versão IMUTÁVEL por linhagem (parent_recipe_id + lineage_kind='regenerated'), NUNCA sobrescreve.
 * origin HERDADO da predecessora; result_kind do classify FRESCO; versões anteriores intactas.
 *
 * Ordem dos guards é LOAD-BEARING (espelha derive/PATCH/o GET da #3):
 *   1. isUuid → 404 (sem tocar o DB; malformado indistinguível de ausente).
 *   2. requireSession → 401 (ANTES do DB; Visitante = zero efeito colateral).
 *   3. resolve `model` de app_config.default_model — FAIL-SAFE: nunca erra (cai no default em
 *      código se a linha sumir); NÃO é barreira de segurança, é só dependência de dado.
 *   4. regenerateRecipe — a ÚNICA barreira fail-closed: o GATE owner+origin+fonte é o 1º toque de
 *      DB, ANTES do Claude — nenhuma chamada paga numa Receita não-própria ou de origem não-regenerável.
 *
 * Mapa de saída (alinhado ao contrato de /api/generations):
 *   - success/degraded/playful → 201 { recipeId, outcome, advisory }.
 *   - impossible               → 200 { outcome:'impossible', advisory } (sem Receita).
 *   - invalid                  → 502 { outcome:'invalid', error:'geracao_invalida' } (nada persiste).
 *   - sem_fonte (origin não-ai_* OU fonte irrecuperável) → 409 { error:'sem_fonte_para_regenerar' }.
 *   - not_found (não-própria, inclui catálogo) → 404 { error:'not_found' } (leak-safe, NUNCA 403).
 */

export const runtime = 'nodejs' // SDK Anthropic + postgres-js exigem Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: Visitante ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  const db = getDb()

  // Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await db.select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_CLAUDE_MODEL

  const res = await regenerateRecipe(db, getClaudeClient(), { recipeId: id, viewerId, model })

  switch (res.kind) {
    case 'ok':
      // imageReviewSuggested (#131): a nova versão herdou a imagem E mudou visualmente vs a
      // predecessora — a UI navega pra nova versão com a dica de revisar a foto.
      return Response.json(
        { recipeId: res.recipeId, outcome: res.outcome, advisory: res.advisory, imageReviewSuggested: res.imageReviewSuggested },
        { status: 201 },
      )
    case 'impossible':
      return Response.json({ outcome: 'impossible', advisory: res.advisory }, { status: 200 })
    case 'invalid':
      return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
    case 'sem_fonte':
      return Response.json({ error: 'sem_fonte_para_regenerar' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

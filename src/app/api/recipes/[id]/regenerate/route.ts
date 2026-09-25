import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { DEFAULT_TEXT_MODEL } from '@/domain/claude-models'
import { settingsForModel } from '@/domain/ai-task-config'
import { appConfig } from '@/db/schema'
import { isUuid } from '@/server/http/params'
import { regenerateRecipe } from '@/server/recipe/regenerate'
import {
  capFromRecipeGenConfig,
  DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
} from '@/domain/recipe-gen-config'
import { parseProCaps } from '@/domain/pro-caps'

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
 *   - limite_geracao (teto diário por papel, #167) → 429 { error:'limite_geracao', retryAfterMs }
 *     (mesmo contrato de POST /api/generations; o Claude NÃO é tocado — custo barrado).
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

  // Modelo + TETO de geração (#167) de app_config — UM toque de DB serve aos dois (a linha singleton
  // carrega ambos). Default em código quando a linha está ausente. O `cap` é resolvido AQUI (fonte
  // ÚNICA capFromRecipeGenConfig) e threado p/ regenerateRecipe barrar ANTES do Claude (custo).
  const [cfg] = await db.select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_TEXT_MODEL
  const settings = settingsForModel('generation', cfg?.aiTasks, model)
  const capByRole = cfg?.recipeGenCapByRole ?? DEFAULT_RECIPE_GEN_CAP_BY_ROLE
  // Fase 2 (#466): tabela pro (re-validada) da MESMA linha singleton. `plan='pro'` + bundle configurado
  // ⇒ teto pro; `free` OU sem tabela pro ⇒ `null` ⇒ teto de hoje (byte-idêntico).
  const proCaps = parseProCaps(cfg?.proCaps)
  const cap = capFromRecipeGenConfig(
    capByRole,
    g.session.user.role,
    g.session.user.plan,
    proCaps?.recipeGen ?? null,
  )

  const res = await regenerateRecipe(db, getClaudeClient(), { recipeId: id, viewerId, model, settings, cap })

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
    case 'limite_geracao':
      // #167: teto diário de geração de receita estourado → 429 com countdown (mesmo contrato do
      // POST /api/generations). A UI mapeia limite_geracao p/ a mensagem amigável de limite.
      return Response.json(
        { error: 'limite_geracao', retryAfterMs: res.retryAfterMs },
        { status: 429 },
      )
  }
}

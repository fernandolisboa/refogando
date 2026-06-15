import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { isCreationMode } from '@/domain/recipe'
import { isPorcoesValidas, isDificuldadeValida } from '@/domain/vocabulary'
import { classify } from '@/domain/generation'
import { persistGeneration } from '@/server/generation/persist'

/**
 * Geração por IA — rota base do contrato (issue #8, §7a; ADR-0010 route handler).
 *
 * POST cria uma tentativa de geração. Fluxo: requireSession (401 Visitante) →
 * valida `mode` + faixas de input do usuário ANTES do seam (400, o cliente do Claude
 * NUNCA é chamado nesses casos) → resolve `model` de `app_config.default_model` →
 * chama o seam mockável → `classify` → persiste conforme a taxonomia.
 *
 * Status: success|degraded|playful → 201 (Receita privada criada); impossible → 200
 * (hard-stop honesto, sem Receita); invalid → 502 (falha upstream, NÃO persiste nada).
 *
 * #11 (estruturado) e #12 (conversa) montam o prompt de verdade; aqui o prompt é um
 * placeholder mínimo — o que #8 entrega é o contrato I/O, não a qualidade do texto.
 */

export const runtime = 'nodejs' // SDK Anthropic + postgres-js exigem Node, não Edge.

const DEFAULT_MODEL = 'claude-opus-4-8'

// Placeholder mínimo (#8 entrega o contrato, não o prompt). #11/#12 substituem.
const SYSTEM_PROMPT = 'Você gera receitas de cozinha no schema canônico.'
const USER_PROMPT = 'Gere uma receita.'

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown
    porcoes?: unknown
    dificuldade?: unknown
  }

  // mode obrigatório + válido.
  if (typeof body.mode !== 'string' || !isCreationMode(body.mode)) {
    return Response.json({ error: 'modo_invalido' }, { status: 400 })
  }
  const mode = body.mode

  // Faixa do INPUT do usuário, ANTES do seam: fora de faixa → 400, o seam NUNCA roda.
  if (body.porcoes != null && (typeof body.porcoes !== 'number' || !isPorcoesValidas(body.porcoes))) {
    return Response.json({ error: 'porcoes_fora_de_faixa' }, { status: 400 })
  }
  if (
    body.dificuldade != null &&
    (typeof body.dificuldade !== 'number' || !isDificuldadeValida(body.dificuldade))
  ) {
    return Response.json({ error: 'dificuldade_fora_de_faixa' }, { status: 400 })
  }

  // Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_MODEL
  const origin = mode === 'conversation' ? 'ai_chat' : 'ai_structured'

  const out = await getClaudeClient().generateRecipe({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT,
    model,
  })
  const result = classify(out)

  // Erro de sistema puro: NÃO persiste nada (sem creation_session/generation/recipe).
  if (result.outcome === 'invalid') {
    return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
  }

  if (result.outcome === 'impossible') {
    await persistGeneration({ result, mode, origin, ownerId, model })
    return Response.json({ outcome: 'impossible', advisory: result.advisory }, { status: 200 })
  }

  // success | degraded | playful → Receita privada + generation.
  const p = await persistGeneration({ result, mode, origin, ownerId, model })
  return Response.json(
    { outcome: result.outcome, recipeId: p?.recipeId ?? null, advisory: result.advisory },
    { status: 201 },
  )
}

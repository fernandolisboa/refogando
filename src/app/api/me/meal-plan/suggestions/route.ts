import { requireSession } from '@/server/auth/guard'
import { getClaudeClient, getDb } from '@/server/deps'
import { parseRequestLocale, readJsonObject } from '@/server/http/params'
import { loadAppConfig } from '@/server/app-config'
import { activeSettings } from '@/domain/ai-task-config'
import { addDays, weekStartOf } from '@/domain/meal-plan'
import {
  buildMenuSuggestionPrompt,
  capForMenuSuggestion,
  menuTargets,
  parseMenuSuggestionRequest,
  resolveMenuSuggestion,
} from '@/domain/menu-suggestion'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import {
  loadMenuCandidates,
  loadMenuPreviewCards,
  loadPlannedSlots,
  recordMenuSuggestionUsage,
} from '@/server/meal-plan/menu-suggestion'
import { QuotaExceededError, peekMenuSuggestionQuota, reserveMenuSuggestionSlot } from '@/server/quota/atomic'

/**
 * Sugestão de cardápio pela IA (ADR-0036) — devolve uma PRÉVIA; nada é gravado no plano.
 *
 * POST ?locale= {days, slots, porcoes?, restricoes?, source?, note?, onlyEmpty?} →
 *   200 `{ items: [{day, slot, recipe, motivo}], comentario, targetCount }`
 *   | 400 dados_invalidos | 422 nada_a_preencher (todos os pares já têm algo) | 422 sem_candidatas
 *   | 429 limite_sugestao (+ retryAfterMs) | 502 sugestao_falhou (erro/recusa do modelo).
 *
 * Ordem: tudo que é barato e pode dar 4xx vem ANTES da reserva da cota (um pedido inválido ou sem
 * candidatas não queima slot); a pré-checagem de cota vem antes das candidatas (quem está no teto não
 * dispara a leitura do pool). A reserva é atômica (lock + recontagem + INSERT) e vem logo antes da IA.
 * O `request.signal` vai pro seam: fechar o painel cancela a chamada.
 */

export const runtime = 'nodejs' // SDK Anthropic exige Node, não Edge.
// A chamada tem prazo de 50s (seam); o default de 10s do Vercel Hobby a mataria com o slot já gasto.
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const userId = g.session.user.id

  const req = parseMenuSuggestionRequest(await readJsonObject(request))
  if (!req) return Response.json({ error: 'dados_invalidos' }, { status: 400 })

  const db = getDb()
  const weekStart = weekStartOf(req.days[0])
  const planned = await loadPlannedSlots({ db, userId, range: { from: weekStart, to: addDays(weekStart, 6) } })
  const targets = menuTargets(req, planned)
  if (targets.length === 0) return Response.json({ error: 'nada_a_preencher' }, { status: 422 })

  const cap = capForMenuSuggestion(g.session.user.role)
  const peek = await peekMenuSuggestionQuota(db, { userId, cap })
  if (!peek.allowed) {
    return Response.json({ error: 'limite_sugestao', retryAfterMs: peek.retryAfterMs }, { status: 429 })
  }

  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const candidates = await loadMenuCandidates({
    db,
    userId,
    slots: req.slots,
    restricoes: req.restricoes,
    source: req.source,
    locale: loc,
    planned,
  })
  if (candidates.length === 0) return Response.json({ error: 'sem_candidatas' }, { status: 422 })

  // Modelo + ajuste da tarefa no admin (ADR-0034). Lido antes da reserva: um erro aqui não gasta slot.
  const task = (await loadAppConfig(db)).aiTasks.menu
  const model = task.model
  const settings = activeSettings('menu', task)

  let eventId: string
  try {
    eventId = await reserveMenuSuggestionSlot(db, { userId, cap })
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return Response.json({ error: 'limite_sugestao', retryAfterMs: err.retryAfterMs }, { status: 429 })
    }
    throw err
  }

  const { systemPrompt, userPrompt, keyToId, keyToTarget } = buildMenuSuggestionPrompt({
    candidates,
    targets,
    note: req.note,
    porcoes: req.porcoes,
    locale: loc,
  })
  const out = await getClaudeClient().suggestMenu({
    systemPrompt,
    userPrompt,
    model,
    settings,
    signal: request.signal,
  })
  if (out.kind !== 'ok') return Response.json({ error: 'sugestao_falhou' }, { status: 502 })
  await recordMenuSuggestionUsage({ db, eventId, model, usage: out.usage })

  const resolved = resolveMenuSuggestion(out.suggestion, { keyToId, keyToTarget, planned })
  const cards = await loadMenuPreviewCards({
    db,
    userId,
    recipeIds: resolved.items.map((i) => i.recipeId),
    requestLocale,
    fallbackName: MESSAGES[loc].minhasCriacoes.semTitulo,
  })
  const items = resolved.items.flatMap((i) => {
    const recipe = cards.get(i.recipeId)
    return recipe ? [{ day: i.day, slot: i.slot, motivo: i.motivo, recipe }] : []
  })

  return Response.json(
    { items, comentario: resolved.comentario, targetCount: targets.length },
    { headers: { 'cache-control': 'no-store' } },
  )
}

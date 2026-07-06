import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { EXTRACTION_MODEL } from '@/server/claude/client'
import { appConfig } from '@/db/schema'
import { buildExtractionPrompt } from '@/domain/ingredient-extraction'
import { isUnidade } from '@/domain/vocabulary'
import {
  capFromExtractionConfig,
  DEFAULT_EXTRACTION_CAP_BY_ROLE,
} from '@/domain/extraction-cap-config'
import { parseProCaps } from '@/domain/pro-caps'
import { reserveExtractionSlot, QuotaExceededError } from '@/server/quota/atomic'

/**
 * Extração de ingredientes (issue #112) — ENTRADA INTELIGENTE do modo Formulário/estruturado.
 *
 * POST recebe `{ rawInput }` (texto natural de ingredientes), chama um modelo BARATO que os
 * ORGANIZA nas linhas estruturadas que o Usuário já edita à mão, e devolve `{ items }`. NÃO
 * gera Receita, NÃO escreve no banco — a Extração só organiza o que o Usuário escreveu
 * (CONTEXT.md: Extração ≠ Geração). O Usuário finaliza as linhas e clica "Gerar receita"
 * (fluxo de /api/generations, inalterado).
 *
 * Fluxo: requireSession PRIMEIRO (401 ao Visitante, fail-closed, ANTES de tocar qualquer
 * coisa) → valida `rawInput` (string, comprimento trimado 10..500) → TETO de extração por papel (#447)
 * RESERVADO ATOMICAMENTE ANTES do seam → buildExtractionPrompt → seam mockável `extractIngredients` com
 * `model: EXTRACTION_MODEL` (modelo barato dedicado, NÃO o app_config.default_model) → normaliza
 * `unidade` via `isUnidade` (gate ÚNICO de unidade; desconhecida → null) → 200 `{ items }`. parse_failed → 502.
 *
 * Teto de EXTRAÇÃO por papel (#447), janela 24h deslizante: sem contador, a rota era um loop ilimitado
 * de chamadas ao Claude (Haiku barato, mas acumulável — pode saturar a conta Anthropic e degradar a
 * geração paga de todos). Agora RESERVA um slot ATOMICAMENTE (advisory lock + recontagem do ledger
 * `extraction_event` + INSERT na MESMA tx, #446) ANTES de tocar o seam; estourou ⇒ 429 `limite_extracao`
 * (o Claude NÃO é tocado). Cap MAIS FOLGADO que o de geração (extração é barata) e admin-editável em
 * `app_config.extraction_cap_by_role`. Reservar ANTES (não persistir depois) fecha a corrida sem esperar
 * a saída — a extração não tem saída durável p/ co-commitar (Extração ≠ Geração).
 */

export const runtime = 'nodejs' // SDK Anthropic exige Node, não Edge.

// Faixa de comprimento da entrada inteligente (decisão reversível). MIN recusa o que é curto
// demais para extrair (vazio, uma palavra solta); MAX é um teto de custo de token/armazenamento
// (req.json() não é limitado por padrão). Medidos sobre `rawInput.trim().length`.
const MIN_RAW_INPUT_LENGTH = 10
const MAX_RAW_INPUT_LENGTH = 500

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { rawInput?: unknown }

  // Validação ANTES do seam: o modelo barato NUNCA é tocado nesses casos.
  if (typeof body.rawInput !== 'string' || body.rawInput.trim().length < MIN_RAW_INPUT_LENGTH) {
    return Response.json({ error: 'entrada_vazia' }, { status: 400 })
  }
  if (body.rawInput.trim().length > MAX_RAW_INPUT_LENGTH) {
    return Response.json({ error: 'entrada_muito_longa' }, { status: 400 })
  }

  // Teto de EXTRAÇÃO por papel (#447), janela 24h deslizante — RESERVADO ATOMICAMENTE ANTES do seam
  // (advisory lock + recontagem do ledger `extraction_event` + INSERT numa única tx, #446). Estourou ⇒
  // 429 `limite_extracao` com countdown, e o Claude NÃO é tocado (custo barrado). Só APÓS a validação
  // barata de comprimento (input inválido não consome slot). cap ∞ (admin/papel ilimitado) ⇒ no-op. A
  // config vem da MESMA linha singleton app_config; default em código quando a linha está ausente.
  const [cfg] = await getDb()
    .select({ extractionCapByRole: appConfig.extractionCapByRole, proCaps: appConfig.proCaps })
    .from(appConfig)
  const capByRole = cfg?.extractionCapByRole ?? DEFAULT_EXTRACTION_CAP_BY_ROLE
  // Fase 2 (#466): tabela pro (re-validada) da MESMA linha singleton. `plan='pro'` + bundle ⇒ teto pro;
  // `free` OU sem tabela ⇒ `null` ⇒ teto de hoje. O `cap` thread p/ reserveExtractionSlot (gate atômico).
  const proCaps = parseProCaps(cfg?.proCaps)
  const cap = capFromExtractionConfig(
    capByRole,
    g.session.user.role,
    g.session.user.plan,
    proCaps?.extraction ?? null,
  )
  try {
    await reserveExtractionSlot(getDb(), { userId: g.session.user.id, cap })
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return Response.json(
        { error: 'limite_extracao', retryAfterMs: err.retryAfterMs },
        { status: 429 },
      )
    }
    throw err
  }

  const { systemPrompt, userPrompt } = buildExtractionPrompt(body.rawInput)
  const out = await getClaudeClient().extractIngredients({
    systemPrompt,
    userPrompt,
    model: EXTRACTION_MODEL,
  })

  if (out.kind === 'parse_failed') {
    return Response.json({ error: 'extracao_falhou' }, { status: 502 })
  }

  // Normaliza `unidade`: `isUnidade` é o gate ÚNICO de unidade. Uma unidade não-reconhecida
  // (o schema a aceitou como string crua) vira null — o Usuário escolhe a unidade certa na UI.
  const items = out.items.map((it) => ({
    rawText: it.rawText,
    quantidade: it.quantidade,
    unidade: it.unidade != null && isUnidade(it.unidade) ? it.unidade : null,
    strength: it.strength,
  }))

  return Response.json({ items }, { status: 200 })
}

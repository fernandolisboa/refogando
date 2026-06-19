import { requireSession } from '@/server/auth/guard'
import { getClaudeClient } from '@/server/deps'
import { EXTRACTION_MODEL } from '@/server/claude/client'
import { buildExtractionPrompt } from '@/domain/ingredient-extraction'
import { isUnidade } from '@/domain/vocabulary'

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
 * coisa) → valida `rawInput` (string, comprimento trimado 10..500) → buildExtractionPrompt →
 * seam mockável `extractIngredients` com `model: EXTRACTION_MODEL` (modelo barato dedicado, NÃO
 * o app_config.default_model) → normaliza `unidade` via `isUnidade` (gate ÚNICO de unidade;
 * desconhecida → null) → 200 `{ items }`. parse_failed → 502.
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

/**
 * Briefing de geração — domínio PURO (issue #11, §3).
 *
 * O Briefing é a ENTRADA estruturada da criação (o "pedido"): ingredientes com força,
 * restrições, cozinha, porções, dificuldade e observações. #11 muda só a ENTRADA — a
 * saída segue o mesmo `RecipeGenSchema` canônico. Este módulo é PURO/TOTAL/SEM THROW
 * e sem DB: espelha o estilo `decide*`/`classify` de `recipe-restrictions.ts`,
 * `recipe-visibility.ts` e `generation.ts`. Reusa o vocabulário culinário
 * (`vocabulary.ts`) e a normalização de texto (`recipe-restrictions.ts`); o único
 * enum novo é `strength` (força do item), com fonte única AQUI.
 *
 * Termos (CONTEXT.md é lei): Briefing/BriefingItem/força (strength)/Aviso. NUNCA
 * Query/Filtro/Prompt-cru/Pedido/Formulário/Wizard/Request/Alerta; SEM Categoria.
 */

import {
  isCozinha,
  isRestricao,
  isUnidade,
  isPorcoesValidas,
  isDificuldadeValida,
} from '@/domain/vocabulary'
import { normalizeText } from '@/domain/recipe-restrictions'
import type { Cozinha, Restricao, Unidade } from '@/domain/vocabulary'

// ── Fonte única do enum `strength` (força do item) ─────────────────────────────
// Vai aqui, não em vocabulary.ts: `strength` é conceito do Briefing, não do kernel
// bidirecional Busca↔criação que vocabulary.ts documenta (decisão #2). `creationModeEnum`
// importa de recipe.ts pelo mesmo motivo; `strengthEnum` importará destes STRENGTHS.
export const STRENGTHS = ['required', 'preferred'] as const
export type Strength = (typeof STRENGTHS)[number]
export function isStrength(value: string): value is Strength {
  return (STRENGTHS as readonly string[]).includes(value)
}

// Teto duro de `observacoes` (decisão reversível, §3.7): recusa só abuso real
// (cola de texto / payload inflado). Generoso o bastante para um parágrafo de
// contexto culinário legítimo.
export const OBSERVACOES_MAX = 2000

// ── Tipos do domínio ───────────────────────────────────────────────────────────
export type BriefingItem = {
  ingredientId: string | null // FK opcional (catálogo ADIADO → normalmente null)
  rawText: string | null
  quantidade: string | null // string|null SEMPRE (numeric trafega como string)
  unidade: Unidade | null
  strength: Strength
}

export type Briefing = {
  cozinha: Cozinha | null
  restricoes: Restricao[]
  porcoes: number | null
  dificuldade: number | null
  observacoes: string | null
  itens: BriefingItem[]
}

// ── Parse + validação de shape (body cru `unknown` → Briefing | erro) ──────────
// Discriminated-union sem throw (espelha `classify`). O código de erro alimenta o
// 400 do handler. `ingrediente_inexistente` NÃO mora aqui (é do handler — exige DB).
export type BriefingParse =
  | { ok: true; briefing: Briefing }
  | {
      ok: false
      error:
        | 'briefing_invalido' // shape errado (não-objeto, tipos errados)
        | 'cozinha_invalida'
        | 'restricao_invalida'
        | 'unidade_invalida'
        | 'strength_invalida'
        | 'porcoes_fora_de_faixa'
        | 'dificuldade_fora_de_faixa'
        | 'observacoes_muito_longas'
        | 'item_sem_identidade'
        | 'briefing_vazio'
    }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Total: recebe o `unknown` aninhado e devolve a união discriminada. Ordem do §3.3:
 * shape → cozinha → restricoes → porcoes → dificuldade → observacoes → itens (shape)
 * → campo-mínimo-DE-ITEM (7b, ANTES do dedup) → dedup → campo-mínimo (briefing_vazio).
 * Faixas validadas AQUI, no app (ADR-0009). Cada falha devolve o PRIMEIRO erro.
 */
export function parseBriefing(raw: unknown): BriefingParse {
  // 1. raw é objeto não-array.
  if (!isPlainObject(raw)) return { ok: false, error: 'briefing_invalido' }

  // 2. cozinha: ausente/null OU isCozinha.
  let cozinha: Cozinha | null = null
  if (raw.cozinha != null) {
    if (typeof raw.cozinha !== 'string' || !isCozinha(raw.cozinha)) {
      return { ok: false, error: 'cozinha_invalida' }
    }
    cozinha = raw.cozinha
  }

  // 3. restricoes: ausente → []; array de strings cada isRestricao.
  let restricoes: Restricao[] = []
  if (raw.restricoes != null) {
    if (!Array.isArray(raw.restricoes)) return { ok: false, error: 'restricao_invalida' }
    const out: Restricao[] = []
    for (const r of raw.restricoes) {
      if (typeof r !== 'string' || !isRestricao(r)) return { ok: false, error: 'restricao_invalida' }
      out.push(r)
    }
    restricoes = out
  }

  // 4. porcoes: ausente/null OU (number ∧ isPorcoesValidas).
  let porcoes: number | null = null
  if (raw.porcoes != null) {
    if (typeof raw.porcoes !== 'number' || !isPorcoesValidas(raw.porcoes)) {
      return { ok: false, error: 'porcoes_fora_de_faixa' }
    }
    porcoes = raw.porcoes
  }

  // 5. dificuldade: idem isDificuldadeValida.
  let dificuldade: number | null = null
  if (raw.dificuldade != null) {
    if (typeof raw.dificuldade !== 'number' || !isDificuldadeValida(raw.dificuldade)) {
      return { ok: false, error: 'dificuldade_fora_de_faixa' }
    }
    dificuldade = raw.dificuldade
  }

  // 6. observacoes: ausente/null OU string com length <= OBSERVACOES_MAX.
  let observacoes: string | null = null
  if (raw.observacoes != null) {
    if (typeof raw.observacoes !== 'string') return { ok: false, error: 'briefing_invalido' }
    if (raw.observacoes.length > OBSERVACOES_MAX) {
      return { ok: false, error: 'observacoes_muito_longas' }
    }
    observacoes = raw.observacoes
  }

  // 7. itens: ausente → []; shape de cada campo.
  const itens: BriefingItem[] = []
  if (raw.itens != null) {
    if (!Array.isArray(raw.itens)) return { ok: false, error: 'briefing_invalido' }
    for (const it of raw.itens) {
      if (!isPlainObject(it)) return { ok: false, error: 'briefing_invalido' }

      // strength obrigatória + isStrength.
      if (typeof it.strength !== 'string' || !isStrength(it.strength)) {
        return { ok: false, error: 'strength_invalida' }
      }
      // unidade: null|isUnidade.
      let unidade: Unidade | null = null
      if (it.unidade != null) {
        if (typeof it.unidade !== 'string' || !isUnidade(it.unidade)) {
          return { ok: false, error: 'unidade_invalida' }
        }
        unidade = it.unidade
      }
      // quantidade: null|string.
      let quantidade: string | null = null
      if (it.quantidade != null) {
        if (typeof it.quantidade !== 'string') return { ok: false, error: 'briefing_invalido' }
        quantidade = it.quantidade
      }
      // rawText: null|string.
      let rawText: string | null = null
      if (it.rawText != null) {
        if (typeof it.rawText !== 'string') return { ok: false, error: 'briefing_invalido' }
        rawText = it.rawText
      }
      // ingredientId: null|string (uuid — validação leve; FK real no banco).
      let ingredientId: string | null = null
      if (it.ingredientId != null) {
        if (typeof it.ingredientId !== 'string') return { ok: false, error: 'briefing_invalido' }
        ingredientId = it.ingredientId
      }

      itens.push({ ingredientId, rawText, quantidade, unidade, strength: it.strength })
    }
  }

  // 7b. campo-mínimo-DE-ITEM (ANTES do dedup): cada item precisa de rawText não-vazio
  // após-trim OU ingredientId não-null. Garante que nenhum item all-null chega ao dedup
  // (a chave de dedup nunca é '' por ausência de identidade).
  for (const it of itens) {
    const temRaw = it.rawText != null && it.rawText.trim() !== ''
    const temFk = it.ingredientId != null
    if (!temRaw && !temFk) return { ok: false, error: 'item_sem_identidade' }
  }

  // 8. dedup (silencioso, sem erro).
  const briefing = dedupeBriefing({
    cozinha,
    restricoes,
    porcoes,
    dificuldade,
    observacoes,
    itens,
  })

  // 9. campo-mínimo: vazio → briefing_vazio.
  if (isBriefingVazio(briefing)) return { ok: false, error: 'briefing_vazio' }

  return { ok: true, briefing }
}

// ── Dedup (AC6, silencioso, sem erro) ──────────────────────────────────────────
/**
 * Dedup silencioso: restrições por igualdade de enum; itens por `ingredientId`
 * quando não-null, senão por `rawText` normalizado (lowercase + sem acento + trim,
 * via `normalizeText` — fonte única de #7). Primeira ocorrência vence; ordem original
 * preservada. NUNCA remove a última cópia (não esvazia um briefing com conteúdo).
 */
export function dedupeBriefing(b: Briefing): Briefing {
  const restricoes = [...new Set(b.restricoes)]

  const itens: BriefingItem[] = []
  const vistos = new Set<string>()
  for (const it of b.itens) {
    const chave =
      it.ingredientId != null ? `id:${it.ingredientId}` : `raw:${normalizeText(it.rawText ?? '')}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    itens.push(it)
  }

  return { ...b, restricoes, itens }
}

// ── Campo mínimo (Briefing não-vazio, AC6) ─────────────────────────────────────
/**
 * `true` (→ 400 briefing_vazio) quando NÃO há ≥1 item E NÃO há ≥1 entre {cozinha
 * não-null, restricoes não-vazio, observacoes não-vazio-após-trim}. porcoes/dificuldade
 * sozinhos NÃO contam (modificadores, não substância): um briefing só com "4 porções"
 * não tem o que gerar (decisão reversível, §3.5).
 */
export function isBriefingVazio(b: Briefing): boolean {
  const temItem = b.itens.length > 0
  const temCozinha = b.cozinha != null
  const temRestricao = b.restricoes.length > 0
  const temObservacoes = b.observacoes != null && b.observacoes.trim() !== ''
  return !(temItem || temCozinha || temRestricao || temObservacoes)
}

// ── Montagem Briefing → { systemPrompt, userPrompt } ───────────────────────────
const SYSTEM_PROMPT_BRIEFING = [
  'Você gera receitas de cozinha no schema canônico.',
  'Respeite estritamente as restrições alimentares e a cozinha indicadas no briefing.',
  'Ingredientes com força "required" são obrigatórios; "preferred" são desejáveis.',
].join(' ')

function rotuloItem(it: BriefingItem): string {
  const nome = it.rawText != null && it.rawText.trim() !== '' ? it.rawText.trim() : (it.ingredientId ?? '')
  const medida = [it.quantidade, it.unidade].filter((x) => x != null && x !== '').join(' ')
  const partes = [`- ${nome} (força: ${it.strength})`]
  if (medida !== '') partes.push(`quantidade: ${medida}`)
  return partes.join('; ')
}

/**
 * PURO e determinístico (testável byte-a-byte): substitui os placeholders de #8.
 * Serializa o Briefing de forma legível e estável; NÃO injeta nada além do Briefing
 * (sem dados de outra sessão). A QUALIDADE da prosa não é critério de #8/#11 — o teste
 * asserta ESTRUTURA (a cozinha, os itens, a força), não o estilo.
 */
export function buildBriefingPrompt(b: Briefing): { systemPrompt: string; userPrompt: string } {
  const linhas: string[] = ['Gere uma receita a partir do seguinte briefing:']
  if (b.cozinha != null) linhas.push(`Cozinha: ${b.cozinha}`)
  if (b.porcoes != null) linhas.push(`Porções: ${b.porcoes}`)
  if (b.dificuldade != null) linhas.push(`Dificuldade: ${b.dificuldade}`)
  if (b.restricoes.length > 0) linhas.push(`Restrições: ${b.restricoes.join(', ')}`)
  if (b.itens.length > 0) {
    linhas.push('Ingredientes:')
    for (const it of b.itens) linhas.push(rotuloItem(it))
  }
  if (b.observacoes != null && b.observacoes.trim() !== '') {
    linhas.push(`Observações: ${b.observacoes.trim()}`)
  }
  return { systemPrompt: SYSTEM_PROMPT_BRIEFING, userPrompt: linhas.join('\n') }
}

// ── Costura para o Aviso (AC5) — montar `items` para o motor #7 ─────────────────
/**
 * PURO. Mapeia cada item para `{ alergenos }` que `decideRestrictionNotices` espera.
 * Item com `ingredientId` resolvido → `alergenos` do mapa (pode ser null/[]); item
 * raw-text-only (FK null) → `{ alergenos: null }` (ausência nunca dispara). O mapa é
 * construído NO HANDLER a partir do SELECT em `ingredient` (único toque de DB); o
 * motor em si é puro. Sem catálogo, todos os itens têm FK null → mapa inerte (correto).
 */
export function briefingItemsParaAviso(
  itens: ReadonlyArray<BriefingItem>,
  alergenosPorIngredient: ReadonlyMap<string, string[] | null>,
): { alergenos: string[] | null }[] {
  return itens.map((it) => {
    if (it.ingredientId == null) return { alergenos: null }
    return { alergenos: alergenosPorIngredient.get(it.ingredientId) ?? null }
  })
}

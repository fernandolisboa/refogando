/**
 * Extração de ingredientes (issue #112) — domínio PURO (sem DB, sem SDK).
 *
 * A ENTRADA INTELIGENTE da tela CRIAR (modo Formulário/estruturado): o Usuário escreve os
 * ingredientes em linguagem natural ("2 cebolas, sal a gosto, um pouco de salsinha") e um
 * modelo BARATO os ORGANIZA nas linhas estruturadas que o Usuário já edita à mão. NÃO é a
 * Geração — a Extração só organiza o que o Usuário escreveu, NUNCA inventa nem gera a Receita.
 * (CONTEXT.md: Extração ≠ Geração.)
 *
 * Este módulo é PURO/TOTAL/SEM THROW: define o schema de saída (structured output, ADR-0009 —
 * SEGUNDO uso da mesma disciplina), o prompt determinístico, e as constantes. A normalização
 * de `unidade` (mapear ou descartar via `isUnidade`) NÃO mora aqui: o schema aceita `unidade`
 * como STRING nullable (nunca o enum), então um valor não-reconhecido pelo modelo JAMAIS faz
 * o parse estourar — a rota normaliza (decisão de robustez, espelha o flat-schema de #8).
 *
 * Termos (CONTEXT.md é lei): a saída alimenta os BriefingItem do Briefing — `rawText`,
 * `quantidade`, `unidade`, `strength` (força do item). NUNCA "Pedido"/"Filtro"/"Request".
 */

import { z } from 'zod'
import { STRENGTHS } from '@/domain/briefing'

/**
 * Schema da saída estruturada da Extração. `unidade` é STRING nullable (NÃO um enum): o modelo
 * barato pode devolver um rótulo de unidade fora do vocabulário controlado, e isso NÃO pode
 * derrubar o parse — a rota chama `isUnidade` e descarta o que não casa (vira null). `strength`
 * é o ÚNICO enum (reusa `STRENGTHS` de briefing.ts, fonte única). `quantidade` é número-string
 * ou null (numeric trafega como string no domínio inteiro).
 */
export const IngredientExtractionSchema = z.object({
  items: z.array(
    z.object({
      rawText: z.string(),
      quantidade: z.string().nullable(),
      unidade: z.string().nullable(),
      strength: z.enum(STRENGTHS),
    }),
  ),
})

/** Um item extraído (cru, ANTES da normalização de unidade na rota). */
export type ExtractionItem = z.infer<typeof IngredientExtractionSchema>['items'][number]

/**
 * Resultado da fronteira da Extração: `ok` com os itens crus, ou `parse_failed` (qualquer
 * erro/null do SDK após o retry de reparo). Espelha o `GenerationOutput.parse_failed` de #8 —
 * a rota mapeia `parse_failed` para 502 e NÃO vaza stack nem item parcial.
 */
export type ExtractionOutput = { kind: 'ok'; items: ExtractionItem[] } | { kind: 'parse_failed' }

// Teto de tokens da Extração. Curto: a Extração organiza uma lista de ingredientes (muito
// menor que uma Receita completa), então 1024 é folgado e barato. Independente do MAX_TOKENS
// da Geração (4096) — a Extração usa um modelo barato com saída pequena.
export const EXTRACTION_MAX_TOKENS = 1024

// As unidades canônicas que o modelo PODE emitir — enumeradas TEXTUALMENTE no system prompt
// (espelha `UNIDADES` de vocabulary.ts, mas NÃO importa o array: o prompt referencia os valores
// como texto; o gate REAL de unidade é `isUnidade` na rota — fonte única, sem duplicar a lógica
// de validação). Se vocabulary.ts ganhar/perder uma unidade, atualize esta lista de prosa.
export const SYSTEM_PROMPT_EXTRACTION = [
  'Você organiza uma lista de ingredientes que o usuário escreveu em linguagem natural.',
  'Sua tarefa é APENAS estruturar o que o usuário escreveu: nunca invente ingredientes, nunca gere uma receita.',
  'Extraia SOMENTE os ingredientes mencionados no texto do usuário.',
  'Para cada ingrediente, devolva:',
  '- rawText: o nome do ingrediente como o usuário o escreveu (sem a quantidade nem a unidade).',
  '- quantidade: o número como string (ex.: "2", "0.5"), ou null se não houver número.',
  '- unidade: um destes valores exatos quando reconhecer a unidade, senão null:',
  '  g, kg, ml, l, colher_de_sopa, colher_de_cha, xicara, unidade, dente, fatia, pitada, a_gosto, q_b.',
  '  Se a unidade mencionada não estiver nessa lista, devolva null.',
  '- strength: "required" por padrão; use "preferred" apenas se o ingrediente for opcional ("se quiser", "opcional", "a gosto" como preferência).',
].join('\n')

/**
 * PURO e determinístico (testável byte-a-byte): monta `{ systemPrompt, userPrompt }` para a
 * Extração. NÃO injeta nada além do texto cru do Usuário (sem dados de outra sessão). O
 * `systemPrompt` é a constante fixa; o `userPrompt` é o texto cru trimado. A rota já validou
 * comprimento e trima ANTES de chamar (espelha `buildFreeTextPrompt` de #88).
 */
export function buildExtractionPrompt(rawInput: string): {
  systemPrompt: string
  userPrompt: string
} {
  return { systemPrompt: SYSTEM_PROMPT_EXTRACTION, userPrompt: rawInput.trim() }
}

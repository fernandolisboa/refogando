/**
 * Schema canônico de geração — `RecipeGenSchema` (issue #8, §2).
 *
 * Camada de domínio, PURO: importa só `zod` e os arrays do kernel (`vocabulary.ts`),
 * mantendo a "fonte única" — os enums vêm de `COZINHAS/CATEGORIAS/RESTRICOES/UNIDADES`,
 * exatamente como `db/schema.ts` mapeia para `pgEnum`. Nada de DB, nada de SDK.
 *
 * É o formato que a chamada constrita da Anthropic (structured outputs via
 * `zodOutputFormat`) emite.
 *
 * ─── FORMA: FLAT-OBJECT (fallback do §2, NÃO a discriminated-union) ──────────────
 * O spike A (§9) PROVOU que a discriminated-union baixa para um JSON Schema com
 * `anyOf` + `$defs`, e o endpoint de structured outputs a REJEITA com 400:
 *   "output_config.format.schema: For 'anyOf', '$defs' is not supported".
 * Por isso usamos o fallback do §2: um único `z.object` com:
 *   - `kind: z.enum(['success','degraded','playful','impossible'])`,
 *   - `receita` NULLABLE (presente em success/degraded/playful; null em impossible),
 *   - `advisory` NULLABLE.
 * A presença/ausência de `receita` vira regra de APP (impossible ⇒ receita null) —
 * ver `classify` em `generation.ts`. `invalid` NÃO aparece aqui: nunca é
 * auto-classificado pelo modelo; só o app o adiciona (parse falhou/refusal/max_tokens).
 *
 * Notas load-bearing:
 *  - `quantidade` é `string|null` (não number): casa com `recipe_ingredient.quantidade`
 *    `numeric(10,3)`, que trafega como string ('2.500'); evita float-drift.
 *  - porcoes/dificuldade são `z.number().int()` SEM min/max — o JSON Schema de
 *    structured outputs strippa min/max; a faixa é checada no app (`classify`).
 */

import { z } from 'zod'
import { COZINHAS, CATEGORIAS, RESTRICOES, UNIDADES } from '@/domain/vocabulary'

// 4 valores que o MODELO pode auto-classificar. `invalid` é só do app (ver §4).
export const RECIPE_GEN_KINDS = ['success', 'degraded', 'playful', 'impossible'] as const

// `quantidade` casa com `recipe_ingredient.quantidade` `numeric(10,3)`: null OU
// numérico válido ('-' opcional, até 7 inteiros, '.' + 1-3 fracionários). Defense-
// in-depth na fronteira do schema — structured output PODE tratar o pattern como
// advisory, então o guard real é `classify` (generation.ts). 'a gosto' vive em rawText.
const QUANTIDADE_RE = /^-?\d{1,7}(\.\d{1,3})?$/

// Item de ingrediente: nasce com rawText (linking canônico é #9/#19).
const IngredienteGen = z.object({
  rawText: z.string(), // → recipe_ingredient.raw_text
  quantidade: z.string().regex(QUANTIDADE_RE).nullable(), // → recipe_ingredient.quantidade (numeric|null)
  unidade: z.enum(UNIDADES).nullable(), // → recipe_ingredient.unidade
})

// Receita "miolo" — 1:1 com recipe + recipe_translation (locale original).
const ReceitaGen = z.object({
  titulo: z.string(), // → recipe_translation.titulo (notNull)
  descricao: z.string().nullable(), // → recipe_translation.descricao
  passos: z.array(z.string()), // → recipe_translation.passos
  notas: z.string().nullable(), // → recipe_translation.notas
  originalLocale: z.string(), // → recipe.original_locale (ex. 'pt-BR')
  cozinha: z.enum(COZINHAS).nullable(), // → recipe.cozinha
  categoria: z.enum(CATEGORIAS).nullable(), // → recipe.categoria
  restricoes: z.array(z.enum(RESTRICOES)), // → recipe.restricoes (default '{}')
  porcoes: z.number().int(), // → recipe.porcoes (faixa validada no app)
  dificuldade: z.number().int(), // → recipe.dificuldade (faixa validada no app)
  // Tempo de preparo (#261, ADR-0023): OUTPUT-ONLY, ambos OPCIONAIS na saída (.nullable().optional()
  // — a IA estima quando dá; geração degradada persiste sem tempo). Sem min/max no Zod (faixa no app,
  // como porcoes/dificuldade). O Briefing NÃO ganha tempo. ativo > total é reconciliado no persist.
  tempoAtivoMin: z.number().int().nullable().optional(), // → recipe.tempo_ativo_min
  tempoTotalMin: z.number().int().nullable().optional(), // → recipe.tempo_total_min
  ingredientes: z.array(IngredienteGen), // → recipe_ingredient[]
})

// FLAT-OBJECT: um único z.object (sem discriminated union → sem anyOf/$defs, que o
// endpoint rejeita). `receita` é nullable; a regra "impossible ⇒ receita null" vive
// no app (classify). `advisory` é IRMÃO de `receita` (Comentário consultivo FORA da
// Receita — ADR-0009).
export const RecipeGenSchema = z.object({
  kind: z.enum(RECIPE_GEN_KINDS),
  receita: ReceitaGen.nullable(),
  advisory: z.string().nullable(),
})

export type RecipeGen = z.infer<typeof RecipeGenSchema>
export type ReceitaGenT = z.infer<typeof ReceitaGen>

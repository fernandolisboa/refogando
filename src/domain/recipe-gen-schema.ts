/**
 * Schema canônico de geração — `RecipeGenSchema` (issue #8, §2).
 *
 * Camada de domínio, PURO: importa só `zod` e os arrays do kernel (`vocabulary.ts`),
 * mantendo a "fonte única" — os enums `CATEGORIAS/RESTRICOES/UNIDADES` vêm do kernel,
 * exatamente como `db/schema.ts` mapeia para `pgEnum`. Nada de DB, nada de SDK.
 *
 * ─── COZINHA é DATA-DRIVEN (#318, ADR-0025) ─────────────────────────────────────
 * Cozinha NÃO é mais um enum estático: `buildRecipeGenSchema(cozinhaSlugs)` constrói o
 * schema constrangendo `cozinha` ao CONJUNTO ATIVO injetado (vindo de `vocabulary_term`
 * na borda), em vez de um `z.enum(COZINHAS)` fixo. A chamada constrita da Anthropic passa
 * o conjunto ATIVO (zodOutputFormat) para o modelo só emitir cozinhas vivas. O conjunto
 * VAZIO cai em `z.string()` (z.enum exige >=1 elemento — estourava na construção). O export
 * estático `RecipeGenSchema = buildRecipeGenSchema([])` mantém os value-imports existentes
 * compilando, com `cozinha: string|null` (Cozinha=string — correto pós-virada).
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
import { CATEGORIAS, RESTRICOES, UNIDADES } from '@/domain/vocabulary'

// 4 valores que o MODELO pode auto-classificar. `invalid` é só do app (ver §4).
export const RECIPE_GEN_KINDS = ['success', 'degraded', 'playful', 'impossible'] as const

// `quantidade` casa com `recipe_ingredient.quantidade` `numeric(10,3)`: null OU
// numérico válido ('-' opcional, até 7 inteiros, '.' + 1-3 fracionários). Defense-
// in-depth na fronteira do schema — structured output PODE tratar o pattern como
// advisory, então o guard real é `classify` (generation.ts). A medida é ESTRUTURADA
// (quantidade/unidade), NUNCA repetida no `nome` (ADR-0012/0009 Adendo 2026-06-30).
const QUANTIDADE_RE = /^-?\d{1,7}(\.\d{1,3})?$/

// Item de ingrediente: o campo de texto é o `nome` SEM a medida (ADR-0009 Adendo 2026-06-30) —
// a medida é a fonte ÚNICA em quantidade/unidade; o nome do campo + o `.describe` são os sinais
// que o structured output lê pra não despejar a linha-com-medida aqui. Mapeia para
// `recipe_ingredient.raw_text` (sem rename de coluna). Linking canônico é #9/#19 (diferido).
const IngredienteGen = z.object({
  nome: z
    .string()
    .describe(
      "nome do ingrediente SEM o número e SEM a unidade do enum (g, kg, ml, l, colher de sopa/chá, xícara, dente, fatia, pitada) — ex.: 'arroz arbóreo', nunca '320 g de arroz arbóreo'. MANTENHA palavras de porção/recipiente que NÃO são unidades do enum (folha, talo, ramo, maço, lata, punhado): '4 folhas de alga nori' → nome 'folhas de alga nori', quantidade 4, unidade 'unidade'. A medida vai em quantidade + unidade.",
    ), // → recipe_ingredient.raw_text
  quantidade: z.string().regex(QUANTIDADE_RE).nullable(), // → recipe_ingredient.quantidade (numeric|null)
  unidade: z.enum(UNIDADES).nullable(), // → recipe_ingredient.unidade
})

/**
 * Receita "miolo" — 1:1 com recipe + recipe_translation (locale original), com `cozinha` constrita ao
 * CONJUNTO ATIVO injetado (#318, ADR-0025 Decisão 4). Conjunto VAZIO ⇒ `z.string()` (z.enum exige >=1
 * elemento — estouraria na construção); senão `z.enum(slugs)`. Fonte ÚNICA da forma da Receita gerada,
 * reusada pelo schema single (`buildRecipeGenSchema`) E pelo schema-lista (`buildRecipeGenListSchema`).
 */
function buildReceitaGenSchema(cozinhaSlugs: readonly string[]) {
  const cozinhaSchema =
    cozinhaSlugs.length > 0 ? z.enum(cozinhaSlugs as [string, ...string[]]) : z.string()

  return z.object({
    titulo: z.string(), // → recipe_translation.titulo (notNull)
    descricao: z.string().nullable(), // → recipe_translation.descricao
    passos: z.array(z.string()), // → recipe_translation.passos
    notas: z.string().nullable(), // → recipe_translation.notas
    originalLocale: z.string(), // → recipe.original_locale (ex. 'pt-BR')
    cozinha: cozinhaSchema.nullable(), // → recipe.cozinha (data-driven, #318)
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
}

/**
 * Constrói o schema canônico de geração constrangendo `cozinha` ao CONJUNTO ATIVO injetado
 * (#318, ADR-0025 Decisão 4). `cozinhaSlugs` vem da tabela `vocabulary_term` (resolvido na
 * BORDA); a chamada constrita da Anthropic passa o conjunto ATIVO para o modelo só emitir
 * cozinhas vivas. A virada #318 trocou `recipe.cozinha` enum→text, então `string|null` é o
 * tipo CORRETO da coluna.
 */
export function buildRecipeGenSchema(cozinhaSlugs: readonly string[]) {
  // FLAT-OBJECT: um único z.object (sem discriminated union → sem anyOf-de-$ref/$defs, que o
  // endpoint rejeita). `receita` é nullable; a regra "impossible ⇒ receita null" vive
  // no app (classify). `advisory` é IRMÃO de `receita` (Comentário consultivo FORA da
  // Receita — ADR-0009).
  return z.object({
    kind: z.enum(RECIPE_GEN_KINDS),
    receita: buildReceitaGenSchema(cozinhaSlugs).nullable(),
    advisory: z.string().nullable(),
  })
}

/**
 * Schema-LISTA de geração para "gerar 2, o usuário escolhe" (#423, ADR-0029 dec.6). Uma ÚNICA chamada
 * structured devolve `{ variacoes: [<item>, <item>] }` — a variedade vem do PROMPT (o Opus 4.8 rejeita
 * sampling), NÃO do schema. Cada item é o MESMO flat object de `buildRecipeGenSchema` (kind/receita/
 * advisory) + `variacao` (o rótulo do pólo auto-atribuído pela IA, ex. "tradicional"/"com um toque
 * criativo"). Cada item passa pelo MESMO `classify` (via `classifyVariants`).
 *
 * ⚠️ SEM `.min(2).max(2)` (nem `.length(2)`) NO ARRAY — VERIFICADO empiricamente com o `zodOutputFormat`
 * atual: QUALQUER limite de tamanho no array faz o zod HOISTAR o item para `$defs` + `$ref`, e o endpoint
 * de structured outputs REJEITA `$defs` com 400 (o MESMO erro que matou a discriminated-union no §9 do
 * #8). O `z.array(item)` PLANO não emite `$defs`/`$ref` (só o `anyOf` benigno das facetas `.nullable()`,
 * que o schema single já usa em produção). A cardinalidade EXATA-2 é garantida (a) pelo PROMPT ("Gere
 * DUAS variações") e (b) no APP — o cliente exige `parsed.variacoes.length === 2`, senão trata como
 * `parse_failed` do lote (erro de geração; NÃO degrada silenciosamente — ADR-0029).
 */
export function buildRecipeGenListSchema(cozinhaSlugs: readonly string[]) {
  const item = z.object({
    kind: z.enum(RECIPE_GEN_KINDS),
    receita: buildReceitaGenSchema(cozinhaSlugs).nullable(),
    advisory: z.string().nullable(),
    // Rótulo do pólo AUTO-ATRIBUÍDO pela IA (o eixo de divergência config-driven que o prompt injeta) —
    // vira `generation.variant_label` (sinal de qual pólo o usuário guardou/escolheu).
    variacao: z.string(),
  })
  // `z.array(item)` PLANO (sem bound — ver o aviso ⚠️ acima). EXATO-2 no prompt + validação no app.
  return z.object({ variacoes: z.array(item) })
}

/**
 * Schema ESTÁTICO permissivo (cozinha = `z.string().nullable()`): preserva os value-imports
 * existentes (client.ts default, testes) e deriva os tipos `RecipeGen`/`ReceitaGenT`. O
 * conjunto VAZIO cai em `z.string()` — `cozinha` vira `string|null`, correto pós-#318.
 */
export const RecipeGenSchema = buildRecipeGenSchema([])

export type RecipeGen = z.infer<typeof RecipeGenSchema>
export type ReceitaGenT = NonNullable<RecipeGen['receita']>

/**
 * Schema-lista ESTÁTICO permissivo (cozinha = `z.string().nullable()`) — deriva os tipos do lote de
 * variações (#423). O RealClaudeClient constrói a versão CONSTRITA por chamada (`buildRecipeGenListSchema
 * (ativos)`); este export serve os value/type-imports (client default, testes).
 */
export const RecipeGenListSchema = buildRecipeGenListSchema([])
export type RecipeGenList = z.infer<typeof RecipeGenListSchema>
/** Um item do lote de variações: o flat object {kind,receita,advisory} + o rótulo `variacao` do pólo. */
export type RecipeGenListItem = RecipeGenList['variacoes'][number]

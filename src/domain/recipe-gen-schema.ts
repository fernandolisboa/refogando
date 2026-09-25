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
 * na borda), em vez de um `z.enum(COZINHAS)` fixo. O conjunto ATIVO vai ao modelo como DICA
 * (zodOutputFormat); fora dele, a cozinha vira null no parse (ADR-0009 Adendo 2026-09-25). O conjunto
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
 *  - `enum`/`pattern` também são só DICA ao modelo; os campos de vocabulário passam por
 *    `z.preprocess` tolerante (ver "TOLERÂNCIA NA FRONTEIRA DO PARSE" abaixo, ADR-0009 Adendo
 *    2026-09-25).
 */

import { z } from 'zod'
import { CATEGORIAS, QUANTIDADE_RE, RESTRICOES, UNIDADES } from '@/domain/vocabulary'
import {
  normalizeCategoria,
  normalizeCozinha,
  normalizeRestricao,
  normalizeUnidade,
  parseMedida,
} from '@/domain/vocabulary-normalize'
import { normalizeText } from '@/domain/recipe-restrictions'

// 4 valores que o MODELO pode auto-classificar. `invalid` é só do app (ver §4).
export const RECIPE_GEN_KINDS = ['success', 'degraded', 'playful', 'impossible'] as const

/**
 * Um valor da saída do modelo que NÃO casou o vocabulário e caiu no fallback (campo null, item de
 * restrição descartado, `kind` inferido, parte da quantidade perdida). Só para log: `valor` é o
 * texto cru que o modelo emitiu.
 */
export type CampoDescartado = {
  campo: 'kind' | 'cozinha' | 'categoria' | 'restricoes' | 'quantidade' | 'unidade'
  valor: string
}
type OnDescarte = (d: CampoDescartado) => void

// ─── TOLERÂNCIA NA FRONTEIRA DO PARSE ────────────────────────────────────────────
// O `zodOutputFormat` rebaixa `enum`/`pattern` a DICA na description do JSON Schema (o modelo NÃO é
// constrito por eles), mas o parse LOCAL do SDK valida o schema zod e LANÇA: um 'Prato principal' em
// `categoria` ou um '1/2' em `quantidade` virava parse_failed → 502 e a geração inteira se perdia.
// Por isso os campos de vocabulário passam por `z.preprocess`: normaliza o que dá (caixa, acento,
// sinônimo PT/EN, fração) e cai no fallback (null / descarta o item) quando não reconhece, NUNCA
// derruba a geração. O JSON Schema enviado não muda: com `io: 'output'` o preprocess emite o schema
// interno, então o enum/pattern seguem indo como dica ao modelo.

/** Campo string-de-vocabulário nullable: normaliza; não reconhecido ⇒ null (e avisa `onDescarte`). */
function tolerante<T extends z.ZodType>(
  campo: CampoDescartado['campo'],
  normalize: (raw: string) => unknown,
  schema: T,
  onDescarte?: OnDescarte,
) {
  return z.preprocess((v) => {
    if (typeof v !== 'string') return v
    const out = normalize(v)
    if (out === null && v.trim() !== '') onDescarte?.({ campo, valor: v })
    return out
  }, schema)
}

// Item de ingrediente: o campo de texto é o `nome` SEM a medida (ADR-0009 Adendo 2026-06-30) —
// a medida é a fonte ÚNICA em quantidade/unidade; o nome do campo + o `.describe` são os sinais
// que o structured output lê pra não despejar a linha-com-medida aqui. Mapeia para
// `recipe_ingredient.raw_text` (sem rename de coluna). Linking canônico é #9/#19 (diferido).
function buildIngredienteGen(onDescarte?: OnDescarte) {
  const item = z.object({
    nome: z
      .string()
      .describe(
        "nome do ingrediente SEM o número e SEM a unidade do enum (g, kg, ml, l, colher de sopa/chá, xícara, dente, fatia, pitada) — ex.: 'arroz arbóreo', nunca '320 g de arroz arbóreo'. MANTENHA palavras de porção/recipiente que NÃO são unidades do enum (folha, talo, ramo, maço, lata, punhado): '4 folhas de alga nori' → nome 'folhas de alga nori', quantidade 4, unidade 'unidade'. A medida vai em quantidade + unidade.",
      ), // → recipe_ingredient.raw_text
    // → recipe_ingredient.quantidade (numeric|null): o pattern vai como dica; `normalizeMedida` normaliza.
    quantidade: z.string().regex(QUANTIDADE_RE).nullable(),
    unidade: tolerante('unidade', normalizeUnidade, z.enum(UNIDADES).nullable(), onDescarte), // → recipe_ingredient.unidade
  })
  return z.preprocess((v) => normalizeMedida(v, onDescarte), item)
}

/**
 * Normaliza a medida do item (`parseMedida`): '2,5'/'1/2' viram numeric; a unidade colada na
 * quantidade ('2 xícaras', 'a gosto') preenche `unidade` quando ela veio ausente ou irreconhecível.
 * Avisa `onDescarte` quando parte da quantidade se perde (faixa '2-3' → 2, texto sem número) ou
 * quando a unidade colada conflita com a do campo.
 */
function normalizeMedida(v: unknown, onDescarte?: OnDescarte): unknown {
  if (!isRecord(v)) return v
  const raw = typeof v.quantidade === 'number' && Number.isFinite(v.quantidade) ? String(v.quantidade) : v.quantidade
  if (typeof raw !== 'string') return v
  const medida = parseMedida(raw)
  if (medida.resto !== '') onDescarte?.({ campo: 'quantidade', valor: raw })
  const unidadeCampo = typeof v.unidade === 'string' ? normalizeUnidade(v.unidade) : null
  // Duas unidades diferentes (quantidade '2 xícaras', unidade 'g'): vale a do campo, e o conflito vai pro log.
  if (unidadeCampo !== null && medida.unidade !== null && medida.unidade !== unidadeCampo) {
    onDescarte?.({ campo: 'unidade', valor: raw })
  }
  const unidade = unidadeCampo === null && medida.unidade !== null ? medida.unidade : v.unidade
  return { ...v, quantidade: medida.quantidade, unidade }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Receita "miolo" — 1:1 com recipe + recipe_translation (locale original), com `cozinha` constrita ao
 * CONJUNTO ATIVO injetado (#318, ADR-0025 Decisão 4). Conjunto VAZIO ⇒ `z.string()` (z.enum exige >=1
 * elemento — estouraria na construção); senão `z.enum(slugs)`. Fonte ÚNICA da forma da Receita gerada,
 * reusada pelo schema single (`buildRecipeGenSchema`) E pelo schema-lista (`buildRecipeGenListSchema`).
 */
function buildReceitaGenSchema(cozinhaSlugs: readonly string[], onDescarte?: OnDescarte) {
  const cozinhaSchema =
    cozinhaSlugs.length > 0 ? z.enum(cozinhaSlugs as [string, ...string[]]) : z.string()
  const ativas = new Set(cozinhaSlugs)

  return z.object({
    titulo: z.string(), // → recipe_translation.titulo (notNull)
    descricao: z.string().nullable(), // → recipe_translation.descricao
    passos: z.array(z.string()), // → recipe_translation.passos
    notas: z.string().nullable(), // → recipe_translation.notas
    // → recipe.original_locale. String LIVRE + dica (NÃO z.enum): o `zodOutputFormat` manda o enum só
    // como dica na description, mas o parse LOCAL do SDK valida o enum e lança — um 'en' do modelo
    // viraria parse_failed (502) antes do `classify`, que normaliza 'en'/'pt'/'en-GB' (e cai no default).
    originalLocale: z
      .string()
      .describe(
        "idioma em que VOCÊ escreveu esta receita (não o do texto de origem): use exatamente 'pt-BR' ou 'en-US'.",
      ),
    // → recipe.cozinha (data-driven, #318). Fora do conjunto ativo ⇒ null (a FK rejeitaria o slug).
    cozinha: tolerante('cozinha', (raw) => normalizeCozinha(raw, ativas), cozinhaSchema.nullable(), onDescarte),
    categoria: tolerante('categoria', normalizeCategoria, z.enum(CATEGORIAS).nullable(), onDescarte), // → recipe.categoria
    // → recipe.restricoes (default '{}'). Termo não reconhecido é DESCARTADO, nunca adivinhado (ADR-0004).
    restricoes: z.preprocess((v) => normalizeRestricoes(v, onDescarte), z.array(z.enum(RESTRICOES))),
    porcoes: z.number().int(), // → recipe.porcoes (faixa validada no app)
    dificuldade: z.number().int(), // → recipe.dificuldade (faixa normalizada no app)
    // Tempo de preparo (#261, ADR-0023): OUTPUT-ONLY, ambos OPCIONAIS na saída (.nullable().optional()
    // — a IA estima quando dá; geração degradada persiste sem tempo). Sem min/max no Zod (faixa no app,
    // como porcoes/dificuldade). O Briefing NÃO ganha tempo. ativo > total é reconciliado no persist.
    tempoAtivoMin: z.number().int().nullable().optional(), // → recipe.tempo_ativo_min
    tempoTotalMin: z.number().int().nullable().optional(), // → recipe.tempo_total_min
    ingredientes: z.array(buildIngredienteGen(onDescarte)), // → recipe_ingredient[]
  })
}

/** Normaliza cada restrição; descarta (e avisa) as não reconhecidas; sem repetição. */
function normalizeRestricoes(v: unknown, onDescarte?: OnDescarte): unknown {
  if (!Array.isArray(v)) return v
  const out = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== 'string') continue
    const r = normalizeRestricao(raw)
    if (r !== null) out.add(r)
    else if (raw.trim() !== '') onDescarte?.({ campo: 'restricoes', valor: raw })
  }
  return [...out]
}

type RecipeGenKind = (typeof RECIPE_GEN_KINDS)[number]

// `kind` em português/sinônimo (o prompt é pt-BR, então é a deriva provável). Chave: minúsculas sem acento.
const KIND_ALIASES: ReadonlyMap<string, RecipeGenKind> = new Map([
  ['sucesso', 'success'],
  ['degradado', 'degraded'],
  ['degradada', 'degraded'],
  ['parcial', 'degraded'],
  ['partial', 'degraded'],
  ['ludico', 'playful'],
  ['ludica', 'playful'],
  ['zoeira', 'playful'],
  ['brincadeira', 'playful'],
  ['joke', 'playful'],
  ['impossivel', 'impossible'],
])

/**
 * `kind` fora dos 4 valores é normalizado (caixa, acento, sinônimo PT) ou INFERIDO em vez de derrubar
 * o parse. Inferido: com receita ⇒ 'degraded' (entrega a Receita sem afirmar que atendeu tudo — o
 * advisory explica; nunca 'success', que apagaria um degradado/lúdico); sem receita ⇒ 'impossible'.
 */
function inferKind(onDescarte?: OnDescarte) {
  return (v: unknown): unknown => {
    if (!isRecord(v) || typeof v.kind !== 'string') return v
    const k = normalizeText(v.kind)
    const kind = (RECIPE_GEN_KINDS as readonly string[]).includes(k) ? (k as RecipeGenKind) : KIND_ALIASES.get(k)
    if (kind !== undefined) return kind === v.kind ? v : { ...v, kind }
    onDescarte?.({ campo: 'kind', valor: v.kind })
    return { ...v, kind: v.receita != null ? 'degraded' : 'impossible' }
  }
}

/**
 * Constrói o schema canônico de geração constrangendo `cozinha` ao CONJUNTO ATIVO injetado
 * (#318, ADR-0025 Decisão 4). `cozinhaSlugs` vem da tabela `vocabulary_term` (resolvido na
 * BORDA); o conjunto ATIVO vai como DICA ao modelo, e uma cozinha fora dele vira null no parse
 * (ADR-0009 Adendo 2026-09-25). A virada #318 trocou `recipe.cozinha` enum→text, então `string|null` é o
 * tipo CORRETO da coluna.
 */
export function buildRecipeGenSchema(cozinhaSlugs: readonly string[], onDescarte?: OnDescarte) {
  // FLAT-OBJECT: um único z.object (sem discriminated union → sem anyOf-de-$ref/$defs, que o
  // endpoint rejeita). `receita` é nullable; a regra "impossible ⇒ receita null" vive
  // no app (classify). `advisory` é IRMÃO de `receita` (Comentário consultivo FORA da
  // Receita — ADR-0009).
  return z.preprocess(
    inferKind(onDescarte),
    z.object({
      kind: z.enum(RECIPE_GEN_KINDS),
      receita: buildReceitaGenSchema(cozinhaSlugs, onDescarte).nullable(),
      advisory: z.string().nullable(),
    }),
  )
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
export function buildRecipeGenListSchema(cozinhaSlugs: readonly string[], onDescarte?: OnDescarte) {
  const item = z.preprocess(
    inferKind(onDescarte),
    z.object({
      kind: z.enum(RECIPE_GEN_KINDS),
      receita: buildReceitaGenSchema(cozinhaSlugs, onDescarte).nullable(),
      advisory: z.string().nullable(),
      // Rótulo do pólo AUTO-ATRIBUÍDO pela IA (o eixo de divergência config-driven que o prompt injeta) —
      // vira `generation.variant_label` (sinal de qual pólo o usuário guardou/escolheu).
      variacao: z.string(),
    }),
  )
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

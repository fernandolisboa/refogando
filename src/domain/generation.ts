/**
 * Kernel puro da taxonomia de geração — `classify` (issue #8, §4).
 *
 * PURO: sem DB, sem SDK; importa só os validadores de faixa do `vocabulary.ts` e o
 * tipo `ReceitaGenT` do schema canônico. Espelha o estilo de `recipe-read.ts`.
 *
 * `GenerationOutput` é o RESULTADO CRU DA FRONTEIRA (discriminated union) que o seam
 * do Claude (`client.ts`) produz — vive AQUI, no domínio, e `client.ts` (server) o
 * importa (e não o contrário): mantém a fronteira sem cheiro de domínio→server.
 *
 * `classify` mapeia esse cru para a taxonomia de 5 valores. Só `success|degraded|
 * playful` tocam `result_kind`/o DB; `impossible` é hard-stop honesto sem Receita;
 * `invalid` é erro de sistema (refusal/max_tokens/parse_failed ou saída fora-de-faixa)
 * que NUNCA exibe lixo parcial. É total e determinística → testável unit sem DB.
 */

import { isPorcoesValidas, isDificuldadeValida } from '@/domain/vocabulary'
import { isSupportedLocale } from '@/i18n/locale'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'
import type { TextUsage } from '@/domain/text-cost'

// `quantidade` trafega como string para casar com `recipe_ingredient.quantidade`
// `numeric(10,3)`. Aceita null OU um numérico válido: '-' opcional, até 7 dígitos
// inteiros, '.' + 1-3 fracionários opcionais. Rejeita '', espaço, '2,5' (vírgula),
// 'a gosto' (isso vive em rawText) e overflow. Guard REAL da fronteira (structured
// output pode tratar o pattern do schema como advisory).
const QUANTIDADE_RE = /^-?\d{1,7}(\.\d{1,3})?$/

function isQuantidadeValida(q: string | null): boolean {
  return q === null || QUANTIDADE_RE.test(q)
}

// 5 valores (auditáveis). Alimenta o pgEnum `generation_outcome`. `result_kind`
// segue CONGELADO em success|degraded|playful — impossible|invalid só vivem aqui.
export const GENERATION_OUTCOMES = ['success', 'degraded', 'playful', 'impossible', 'invalid'] as const
export type GenerationOutcome = (typeof GENERATION_OUTCOMES)[number]

// RESULTADO CRU DA FRONTEIRA — NÃO é um result_kind. `recipe` é null quando
// `modelKind === 'impossible'` (a Receita é omitida nesse branch).
export type GenerationOutput =
  | {
      kind: 'object'
      recipe: ReceitaGenT | null
      advisory: string | null
      modelKind: 'success' | 'degraded' | 'playful' | 'impossible'
      // #423 (ADR-0029 dec.6): rótulo do PÓLO de divergência auto-atribuído pela IA, presente SÓ no
      // caminho "gerar 2" (`generateRecipeVariants` mapeia `variacoes[].variacao` pra cá). AUSENTE no
      // caminho single (`generateRecipe`) — OPCIONAL, back-compat: `classify` o ignora; `classifyVariants`
      // o carrega pro persist (`generation.variant_label`).
      variacao?: string
      // #463: telemetria de custo (tokens input/output) do `message.usage` da Anthropic, anexada pelo
      // seam (RealClaudeClient). PROVENIÊNCIA, ortogonal à classificação — `classify` a IGNORA; a BORDA
      // a lê de `out.usage` e a passa ao persist, que deriva o `cost_usd` snapshot. OPCIONAL/best-effort:
      // ausente (FakeClaudeClient, telemetria indisponível) ⇒ undefined ⇒ custo NULL honesto. No lote de
      // variações o seam a anexa SÓ à 1ª (o `message.usage` é do lote inteiro — anexar às 2 dobraria).
      usage?: TextUsage
    }
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'parse_failed' }

export type ClassifyResult =
  | { outcome: 'success' | 'degraded' | 'playful'; recipe: ReceitaGenT; advisory: string | null }
  | { outcome: 'impossible'; advisory: string | null }
  | { outcome: 'invalid' }

/**
 * Mapeia o cru da fronteira para a taxonomia. refusal/max_tokens/parse_failed →
 * invalid. object+impossible → impossible (carrega advisory, sem recipe).
 * object+{success,degraded,playful} → checa faixa no app: se porcoes E dificuldade
 * válidas → outcome = modelKind (carrega recipe+advisory); senão → invalid (NÃO
 * clampar). Um valor fora-de-faixa na saída do modelo vira erro de sistema.
 */
export function classify(out: GenerationOutput): ClassifyResult {
  if (out.kind !== 'object') return { outcome: 'invalid' }

  if (out.modelKind === 'impossible') {
    return { outcome: 'impossible', advisory: out.advisory }
  }

  // success|degraded|playful: a Receita está presente (recipe não-null por contrato).
  const recipe = out.recipe
  if (recipe === null) return { outcome: 'invalid' }
  if (!isPorcoesValidas(recipe.porcoes) || !isDificuldadeValida(recipe.dificuldade)) {
    return { outcome: 'invalid' }
  }
  // originalLocale lixo (vazio/espaço/não-suportado) NUNCA persiste → invalid.
  if (!isSupportedLocale(recipe.originalLocale)) {
    return { outcome: 'invalid' }
  }
  // quantidade fora-de-faixa (não-numérica/overflow) NUNCA chega ao DB → invalid.
  if (!recipe.ingredientes.every((ing) => isQuantidadeValida(ing.quantidade))) {
    return { outcome: 'invalid' }
  }
  return { outcome: out.modelKind, recipe, advisory: out.advisory }
}

/**
 * Uma variação CLASSIFICADA que produziu Receita (#423, ADR-0029 dec.6) + o rótulo do pólo. Só
 * `success|degraded|playful` entram numa escolha "gerar 2" (uma variação `impossible`/`invalid` não tem
 * Receita — não há o que escolher); o `variacao` (rótulo do pólo, auto-atribuído pela IA) viaja pro
 * persist (`generation.variant_label`, o sinal de qual pólo o usuário guardou).
 */
export type VariantClassifyResult = {
  outcome: 'success' | 'degraded' | 'playful'
  recipe: ReceitaGenT
  advisory: string | null
  variacao: string
  // #463: telemetria de custo do LOTE, presente SÓ na variação que a carrega (o seam anexa o
  // `message.usage` do lote inteiro à 1ª variação retornada). As demais ficam `undefined` ⇒ custo NULL —
  // assim a soma do custo do lote NÃO é dobrada. A borda a passa ao persist junto de cada variação.
  usage?: TextUsage
}

/**
 * Classifica o LOTE de variações reusando `classify` por item e FILTRA as que não produziram Receita
 * (impossible/invalid). PURA/total. A cardinalidade EXATA-2 NÃO é decidida aqui — é a BORDA (route) que,
 * pós-filtro, exige 2 variações válidas, senão devolve erro de geração (não degrada — ADR-0029). Um lote
 * cujo parse falhou chega como `[{kind:'parse_failed'}]` (ou vazio) ⇒ filtra pra `[]` ⇒ a borda 502a.
 */
export function classifyVariants(outs: readonly GenerationOutput[]): VariantClassifyResult[] {
  const out: VariantClassifyResult[] = []
  for (const raw of outs) {
    const c = classify(raw)
    if (c.outcome === 'success' || c.outcome === 'degraded' || c.outcome === 'playful') {
      // `raw` é forçosamente o branch 'object' aqui (só ele classifica em success/degraded/playful).
      const variacao = raw.kind === 'object' ? (raw.variacao ?? '') : ''
      // #463: carrega a telemetria de custo do LOTE (presente só na variação que a tem — ver acima).
      const usage = raw.kind === 'object' ? raw.usage : undefined
      out.push({ outcome: c.outcome, recipe: c.recipe, advisory: c.advisory, variacao, usage })
    }
  }
  return out
}

/**
 * Config da VARIAÇÃO DE GERAÇÃO ("gerar 2, o usuário escolhe") — admin-configurável (issue #423,
 * ADR-0029 dec.6). PURO: tipos + defaults + validação. ESPELHA `@/domain/image-gen-config`
 * (`enabled`/parse); a diferença de forma é o EIXO DE DIVERGÊNCIA config-driven (poloA/poloB/instrucao)
 * em vez de modelo/teto.
 *
 * A variedade vem do PROMPT, JAMAIS de sampling — o Opus 4.8 rejeita `temperature`/`top_p`/`seed` (400).
 * Uma única chamada structured devolve uma LISTA de 2 receitas; o system prompt instrui divergência
 * genuína ao longo do eixo `poloA` vs `poloB` (ex.: "tradicional" vs "com um toque criativo"), com a
 * `instrucao` refinando o COMO. Editável pelo admin SEM deploy (o "dinâmico, não hardcoded" do dono).
 *
 * Forma `recipeVariant { enabled, poloA, poloB, instrucao }`:
 *  - `enabled`: liga/desliga a OFERTA do opt-in "Gerar 2 versões" (desligado ⇒ a rota ignora `variar2`
 *    e a UI esconde o checkbox). Default DESLIGADO: custa ~2× tokens de saída, então é opt-in e o admin
 *    o acende de propósito (ADR-0029 dec.6 — "opt-in / com teto, não sempre-ligado sem limite").
 *  - `poloA`/`poloB`: os dois pólos do eixo de divergência (rótulos curtos que a IA usa como norte).
 *  - `instrucao`: refina COMO divergir (ex.: "divirja no método, não na identidade do prato").
 */

/** Config da variação de geração (#423). */
export type RecipeVariantConfig = {
  enabled: boolean
  poloA: string
  poloB: string
  instrucao: string
}

/**
 * Config default — OFERTA DESLIGADA (opt-in, custa 2× tokens: o admin acende de propósito), com um
 * eixo de divergência sensato já preenchido (tradicional × criativo). Usada quando não há linha
 * `app_config` ou quando a leitura re-valida e cai no fail-safe.
 */
export const DEFAULT_RECIPE_VARIANT_CONFIG: RecipeVariantConfig = {
  enabled: false,
  poloA: 'tradicional',
  poloB: 'com um toque criativo',
  instrucao:
    'Mantenha as duas fiéis ao pedido; divirjam no método e nos ingredientes de destaque, não na identidade do prato.',
}

export type RecipeVariantConfigParse = { ok: true; value: RecipeVariantConfig } | { ok: false }

/**
 * Valida o objeto `recipeVariant` cru do PUT do admin (substituição COMPLETA — a UI sempre envia os 4
 * campos). `enabled` boolean; `poloA`/`poloB`/`instrucao` strings NÃO-vazias após trim (um pólo ou uma
 * instrução vazia deixaria o fragmento de prompt sem norte). As strings são TRIMADAS no valor devolvido.
 * Qualquer desvio ⇒ `{ ok: false }` (o route mapeia a 400). PURO: sem DB/I/O — espelha `parseImageGenConfig`.
 */
export function parseRecipeVariantConfig(raw: unknown): RecipeVariantConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { enabled?: unknown; poloA?: unknown; poloB?: unknown; instrucao?: unknown }
  if (typeof obj.enabled !== 'boolean') return { ok: false }
  const poloA = trimNonEmpty(obj.poloA)
  const poloB = trimNonEmpty(obj.poloB)
  const instrucao = trimNonEmpty(obj.instrucao)
  if (poloA === null || poloB === null || instrucao === null) return { ok: false }
  return { ok: true, value: { enabled: obj.enabled, poloA, poloB, instrucao } }
}

/** String não-vazia após trim (o valor trimado), ou `null` (ausente/não-string/vazia). */
function trimNonEmpty(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

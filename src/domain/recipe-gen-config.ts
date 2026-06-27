/**
 * Config da GERAÇÃO DE RECEITA por IA — admin-configurável (issue #167). PURO: tipos + defaults +
 * validação + resolução do teto. ESPELHA `@/domain/image-gen-config` (cap de imagem, #134): a única
 * diferença de forma é o ESCOPO (cap de geração de RECEITA, não de imagem) — por isso este módulo só
 * carrega `recipeGenCapByRole` (não há `enabled`/`model`: a geração de receita é o core do produto,
 * sempre ligada, e o modelo de chat já vive em `default_model`).
 *
 * Teto diário por papel na janela 24h DESLIZANTE (mesma semântica do teto de imagem, ADR-0017):
 *  - `null` = ILIMITADO (admin ∞) — JSON não tem `Infinity`, então persistimos `null` no jsonb e
 *    mapeamos `null → Infinity` em `capFromRecipeGenConfig`.
 *  - `0` = bloqueia aquele papel (config futura pode zerar um papel).
 *
 * `decideRecipeGenQuota` (recipe-gen-quota.ts) recebe o `cap` por PARÂMETRO; a RESOLUÇÃO do cap por
 * papel (defaults + `null`=ilimitado, fail-closed) vive AQUI — fonte ÚNICA, evita drift de defaults.
 */

import { ROLES, type Role } from '@/domain/user'

/** Teto diário por papel. `null` = ilimitado (mapeado a `Infinity` em `capFromRecipeGenConfig`). */
export type RecipeGenCapByRole = Record<Role, number | null>

/**
 * Defaults FIXOS do teto de geração de RECEITA. Mais folgados que os de imagem (imagem custa Gemini
 * por chamada; a receita é o core do produto e queremos atrito baixo): usuario 10/dia, curador 20/dia,
 * admin ilimitado. Reversível — o admin ajusta na `/admin/ia`.
 */
export const DEFAULT_RECIPE_GEN_CAP_BY_ROLE: RecipeGenCapByRole = {
  usuario: 10,
  curador: 20,
  admin: null,
}

/**
 * Teto numérico para um papel A PARTIR da config. `null` (papel ilimitado, p.ex. admin) ⇒ `Infinity`
 * (que `decideRecipeGenQuota` lê como "sempre permite"). `role` null/desconhecido (não deveria
 * ocorrer pós-requireSession) ⇒ FAIL-CLOSED no teto de `usuario` (nunca libera geração sem papel
 * claro). Espelha `capFromConfig` de image-gen-config.ts.
 */
export function capFromRecipeGenConfig(caps: RecipeGenCapByRole, role: Role | null): number {
  const raw = role != null ? caps[role] : caps.usuario
  return raw == null ? Infinity : raw
}

/**
 * Valida um teto por papel cru (entrada do PUT do admin). Exige um objeto com EXATAMENTE os papéis
 * conhecidos, cada valor `null` (ilimitado) ou um INTEIRO ≥ 0 (0 = bloqueia o papel). Rejeita
 * float/negativo/NaN/chave estranha. Sem `as`: estreita por checagem. Espelha `parseCapByRole`.
 */
export function parseRecipeGenCapByRole(raw: unknown): RecipeGenCapByRole | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entries = raw as Record<string, unknown>
  // Nenhuma chave estranha (contrato fechado: exatamente os papéis conhecidos).
  for (const key of Object.keys(entries)) {
    if (!(ROLES as readonly string[]).includes(key)) return null
  }
  const out = {} as RecipeGenCapByRole
  for (const role of ROLES) {
    const v = entries[role]
    if (v === null) {
      out[role] = null
    } else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
      out[role] = v
    } else {
      return null
    }
  }
  return out
}

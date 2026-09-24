/**
 * Config do TETO de EXTRAÇÃO de ingredientes por IA — admin-configurável (issue #447). PURO: tipos +
 * defaults + validação + resolução do teto. ESPELHA `@/domain/recipe-gen-config` (teto de geração de
 * RECEITA, #167) 1:1 — a única diferença é o ESCOPO (extração barata via Haiku, NÃO geração via Opus) e,
 * por isso, defaults MAIS FOLGADOS (a extração só ORGANIZA texto; CONTEXT.md: Extração ≠ Geração).
 *
 * Teto diário por papel na janela 24h DESLIZANTE (mesma semântica dos tetos de imagem/receita): a
 * decisão reusa `decideRecipeGenQuota` (função pura de janela deslizante, fonte ÚNICA do cálculo) — este
 * módulo só resolve o CAP por papel. Contado a partir do ledger `extraction_event` (uma linha por
 * extração; sem "devolver slot"), via o gate ATÔMICO `assertExtractionSlotInTx` (#446).
 *  - `null` = ILIMITADO (admin ∞) — JSON não tem `Infinity`, então persistimos `null` no jsonb e
 *    mapeamos `null → Infinity` em `capFromExtractionConfig`.
 *  - `0` = bloqueia aquele papel (config futura pode zerar um papel).
 */

import { ROLES, type Role } from '@/domain/user'
import { DEFAULT_PLAN, type Plan } from '@/domain/plan'

/** Teto diário de EXTRAÇÃO por papel. `null` = ilimitado (mapeado a `Infinity`). */
export type ExtractionCapByRole = Record<Role, number | null>

/**
 * Defaults FIXOS do teto de EXTRAÇÃO. MAIS FOLGADOS que os de geração de receita (usuario 10, curador
 * 20): a extração é BARATA (Haiku) e só organiza a entrada — atrito baixo, mas ainda LIMITADO (fecha o
 * loop ilimitado da #447). usuario 60/dia, curador 120/dia, admin ilimitado. Reversível — admin ajusta.
 */
export const DEFAULT_EXTRACTION_CAP_BY_ROLE: ExtractionCapByRole = {
  usuario: 60,
  curador: 120,
  admin: null,
}

/**
 * Teto numérico para um papel A PARTIR da config. `null` (papel ilimitado, p.ex. admin) ⇒ `Infinity`
 * (que `decideRecipeGenQuota` lê como "sempre permite"). `role` null/desconhecido (não deveria ocorrer
 * pós-requireSession) ⇒ FAIL-CLOSED no teto de `usuario`. Espelha `capFromRecipeGenConfig`.
 *
 * EIXO `plan` (#466, scaffold flag-off): considera o plano comercial ALÉM do papel. Default
 * (`plan='free'` OU sem `proCaps`) ⇒ BYTE-IDÊNTICO ao de hoje (tabela `caps`). Só `plan==='pro'` COM
 * `proCaps` (Fase 2) puxa o teto `pro`. NÃO ativa cobrança nem muda teto efetivo agora.
 */
export function capFromExtractionConfig(
  caps: ExtractionCapByRole,
  role: Role | null,
  plan: Plan = DEFAULT_PLAN,
  proCaps?: ExtractionCapByRole | null,
): number {
  const table = plan === 'pro' && proCaps != null ? proCaps : caps
  const raw = role != null ? table[role] : table.usuario
  return raw == null ? Infinity : raw
}

/**
 * Valida um teto por papel cru (entrada do PUT do admin). Exige um objeto com EXATAMENTE os papéis
 * conhecidos, cada valor `null` (ilimitado) ou um INTEIRO ≥ 0 (0 = bloqueia o papel). Rejeita
 * float/negativo/NaN/chave estranha. Sem `as`: estreita por checagem. Espelha `parseRecipeGenCapByRole`.
 */
export function parseExtractionCapByRole(raw: unknown): ExtractionCapByRole | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entries = raw as Record<string, unknown>
  for (const key of Object.keys(entries)) {
    if (!(ROLES as readonly string[]).includes(key)) return null
  }
  const out = {} as ExtractionCapByRole
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

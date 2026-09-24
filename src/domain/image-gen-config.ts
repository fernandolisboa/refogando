/**
 * Config da geração de imagem por IA — admin-configurável (issue #134, ADR-0017). PURO: tipos +
 * defaults + validação + resolução do teto. A fatia #132 deixou os defaults FIXOS (`image-quota.ts`:
 * `DAILY_IMAGE_GEN_CAP_BY_ROLE`/`capForRole`); #134 move a fonte para a config do admin
 * (singleton `app_config`) e passa os valores no lugar dos fixos. `decideImageQuota` já recebe o
 * `cap` por parâmetro — aqui só resolvemos o cap A PARTIR da config.
 *
 * Forma `imageGen { enabled, model, dailyCapByRole }`:
 *  - `enabled`: liga/desliga a geração (desligada ⇒ a rota bloqueia, a UI esconde a ação).
 *  - `model`: modelo do gerador (allowlist EM CÓDIGO — muda mais rápido que migração; estática de
 *    propósito, ao contrário da lista viva do `default_model`, ADR-0033). Repassado ao seam `ImageGenerator`.
 *  - `dailyCapByRole`: teto diário por papel na janela 24h. `null` = ILIMITADO (admin ∞) — JSON não
 *    tem `Infinity`, então persistimos `null` no jsonb e mapeamos `null → Infinity` em `capFromConfig`.
 */

import { ROLES, type Role } from '@/domain/user'
import { DEFAULT_PLAN, type Plan } from '@/domain/plan'

/**
 * Modelo default do gerador (Nano Banana 2, ADR-0017). Definido AQUI (domínio) — fonte única; o seam
 * `image-generator.ts` (server) o importa daqui (direção de camada correta: server depende de domínio).
 */
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image'

/**
 * Allowlist de modelos de imagem (EM CÓDIGO, não enum de banco; o `default_model` de texto usa a lista
 * viva da Anthropic, ADR-0033). Hoje só o Nano Banana 2; novos modelos entram aqui sem migração.
 */
export const IMAGE_GEN_MODELS = [DEFAULT_IMAGE_MODEL] as const
export type ImageGenModel = (typeof IMAGE_GEN_MODELS)[number]

export function isImageGenModel(v: unknown): v is ImageGenModel {
  return typeof v === 'string' && (IMAGE_GEN_MODELS as readonly string[]).includes(v)
}

/** Teto diário por papel. `null` = ilimitado (mapeado a `Infinity` em `capFromConfig`). */
export type ImageGenCapByRole = Record<Role, number | null>

/** Defaults FIXOS (mesmos números de `DAILY_IMAGE_GEN_CAP_BY_ROLE` da #132; admin ilimitado = null). */
export const DEFAULT_IMAGE_GEN_CAP_BY_ROLE: ImageGenCapByRole = {
  usuario: 3,
  curador: 5,
  admin: null,
}

export type ImageGenConfig = {
  enabled: boolean
  model: ImageGenModel
  dailyCapByRole: ImageGenCapByRole
}

/** Config default (geração LIGADA, modelo default, tetos fixos da #132) — usada quando não há linha. */
export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  enabled: true,
  model: DEFAULT_IMAGE_MODEL,
  dailyCapByRole: DEFAULT_IMAGE_GEN_CAP_BY_ROLE,
}

/**
 * Teto numérico para um papel A PARTIR da config. `null` (papel ilimitado, p.ex. admin) ⇒ `Infinity`
 * (que `decideImageQuota` lê como "sempre permite"). `role` null/desconhecido (não deveria ocorrer
 * pós-requireSession) ⇒ FAIL-CLOSED no teto de `usuario` (nunca libera geração paga sem papel claro).
 * Espelha a semântica de `capForRole` (#132), mas lendo da config.
 *
 * EIXO `plan` (#466, scaffold flag-off): considera o plano comercial ALÉM do papel. Default
 * (`plan='free'` OU sem `proCaps`) ⇒ BYTE-IDÊNTICO ao de hoje (tabela `caps`). Só `plan==='pro'` COM
 * `proCaps` (Fase 2) puxa o teto `pro`. NÃO ativa cobrança nem muda teto efetivo agora.
 */
export function capFromConfig(
  caps: ImageGenCapByRole,
  role: Role | null,
  plan: Plan = DEFAULT_PLAN,
  proCaps?: ImageGenCapByRole | null,
): number {
  const table = plan === 'pro' && proCaps != null ? proCaps : caps
  const raw = role != null ? table[role] : table.usuario
  return raw == null ? Infinity : raw
}

/**
 * Valida um teto por papel cru (entrada do PUT do admin). Exige um objeto com EXATAMENTE os papéis
 * conhecidos, cada valor `null` (ilimitado) ou um INTEIRO ≥ 0 (0 = bloqueia aquele papel; o futuro
 * permite zerar). Rejeita float/negativo/NaN/chave estranha. Sem `as`: estreita por checagem.
 *
 * EXPORTADA (Fase 2 de billing): a `proCaps.imageGen` (tabela `pro` do teto de imagem) reusa ESTE
 * validador — mesma disciplina de `parseRecipeGenCapByRole`/`parseExtractionCapByRole`, fonte ÚNICA.
 */
export function parseImageGenCapByRole(raw: unknown): ImageGenCapByRole | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entries = raw as Record<string, unknown>
  // Nenhuma chave estranha (contrato fechado: exatamente os papéis conhecidos).
  for (const key of Object.keys(entries)) {
    if (!(ROLES as readonly string[]).includes(key)) return null
  }
  const out = {} as ImageGenCapByRole
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

export type ImageGenConfigParse =
  | { ok: true; value: ImageGenConfig }
  | { ok: false }

/**
 * Valida o objeto `imageGen` cru do PUT (substituição COMPLETA — a UI sempre envia os 3 campos).
 * `enabled` boolean; `model` na allowlist; `dailyCapByRole` válido. Qualquer desvio ⇒ `{ ok: false }`
 * (o route mapeia a 400). PURO: sem DB/I/O.
 */
export function parseImageGenConfig(raw: unknown): ImageGenConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { enabled?: unknown; model?: unknown; dailyCapByRole?: unknown }
  if (typeof obj.enabled !== 'boolean') return { ok: false }
  if (!isImageGenModel(obj.model)) return { ok: false }
  const caps = parseImageGenCapByRole(obj.dailyCapByRole)
  if (caps === null) return { ok: false }
  return { ok: true, value: { enabled: obj.enabled, model: obj.model, dailyCapByRole: caps } }
}

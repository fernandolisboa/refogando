/**
 * Plano comercial (eixo de entitlement) — kernel de domínio (issue #466, scaffold de paywall).
 *
 * Mesma FORMA de `user.ts` (ROLES) e `recipe.ts`: array `as const` + tipo derivado + guard puro +
 * default. É o eixo COMERCIAL por Usuário (`free`/`pro`), ORTOGONAL ao `role` (eixo de PRIVILÉGIO:
 * usuario/curador/admin). A resolução de teto (`recipe-gen-config`/`image-gen-config`/
 * `extraction-cap-config`) passa a considerar `plan` ALÉM de `role`, mas o DEFAULT (`free`) é
 * BYTE-IDÊNTICO ao comportamento de hoje: sem tabela `pro` configurada, todo mundo pega o teto de
 * hoje. Este módulo NÃO ativa cobrança nem trava a estratégia de preço — só define o eixo (Fase 2 de
 * billing liga o resto). `schema.ts` mapeia este array para `pgEnum('plan')`.
 */
export const PLANS = ['free', 'pro'] as const
export type Plan = (typeof PLANS)[number]

export function isPlan(v: string): v is Plan {
  return (PLANS as readonly string[]).includes(v)
}

/** Plano default de conta nova (scaffold flag-off: todo mundo nasce `free` = comportamento atual). */
export const DEFAULT_PLAN: Plan = 'free'

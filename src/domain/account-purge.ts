/**
 * Kernel de domínio do EXPURGO FÍSICO pós-retenção da conta anonimizada (issue #411, LGPD Art. 16;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). PURO (sem DB, sem I/O, sem `Date.now()`): recebe o
 * `anonymized_at` do titular (carimbado na eliminação self-service #401) e um "agora" INJETADO, e decide
 * se a linha já passou do prazo de retenção. Mesma forma dos demais kernels (`dsar-sla`): constante +
 * helper puro; idade em dias por ms/86_400_000.
 *
 * O expurgo NÃO é hard-delete da linha `users` (recipe.owner_id é ON DELETE RESTRICT e o conteúdo
 * anonimizado é MANTIDO por decisão de produto/jurídica): é a remoção dos BLOBS de PII residual (foto de
 * avaliação) + nulagem dos ponteiros, depois que a retenção legal expira.
 */

/**
 * Prazo de retenção (dias) a partir da anonimização antes do expurgo físico. 180 é um default
 * CONSERVADOR — [a confirmar no sign-off jurídico #276]. O server pode sobrescrever via env
 * `ACCOUNT_PURGE_RETENTION_DAYS` (lido no ponto de uso, nunca aqui no kernel puro).
 */
export const RETENTION_DAYS = 180

const MS_PER_DAY = 86_400_000

/**
 * Dias COMPLETOS decorridos desde `anonymizedAt` até `now` (ambos injetados). Floor sobre a diferença em
 * ms → "N dias desde". Robusto a fuso: usa epoch (UTC), monotônico. PURO.
 */
export function anonymizedAgeDays(anonymizedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - anonymizedAt.getTime()) / MS_PER_DAY)
}

/**
 * A conta anonimizada já passou do prazo de retenção (é candidata a expurgo físico)? PURO. `retentionDays`
 * default = `RETENTION_DAYS`; o server passa o valor resolvido pela env quando sobrescrito. Idade negativa
 * (relógio adiantado / `anonymizedAt` no futuro) → false (nunca expurga cedo).
 */
export function isPastRetention(
  anonymizedAt: Date,
  now: Date,
  retentionDays: number = RETENTION_DAYS,
): boolean {
  return anonymizedAgeDays(anonymizedAt, now) >= retentionDays
}

/**
 * Teto de geração de imagem por IA — janela de 24h DESLIZANTE (issue #132, ADR-0017). PURO/total:
 * decide se cabe MAIS uma geração e, quando estoura, em quanto tempo o próximo slot libera (countdown).
 *
 * Por que janela deslizante (não dia-de-calendário): é a única com teto de custo realmente DURO
 * (≤ cap gerações em QUALQUER janela de 24h) e sem o incentivo perverso de empilhar gerações na
 * virada da meia-noite. Contado a partir das próprias linhas `recipe_image` com
 * `provenance = ai_generated` do usuário — sem contador separado pra manter.
 *
 * Tetos por papel FIXOS nesta fatia (#132); a fatia do admin (#134) passa os valores da config no
 * lugar — por isso `decideImageQuota` recebe o `cap` por parâmetro (não lê o mapa direto).
 */

import type { Role } from '@/domain/user'

/** Janela deslizante de 24h em ms. */
export const IMAGE_GEN_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Teto diário por papel (defaults FIXOS, ADR-0017). `admin: Infinity` = sem teto. #134 substitui
 * estes valores pelos da config do admin (mesma forma role→número).
 */
export const DAILY_IMAGE_GEN_CAP_BY_ROLE: Record<Role, number> = {
  usuario: 3,
  curador: 5,
  admin: Infinity,
}

/**
 * Teto para um papel. `null`/desconhecido (não deveria ocorrer pós-requireSession) → FAIL-CLOSED no
 * teto mais restritivo (`usuario`), nunca liberando geração paga para um papel indefinido.
 */
export function capForRole(role: Role | null): number {
  return role != null ? DAILY_IMAGE_GEN_CAP_BY_ROLE[role] : DAILY_IMAGE_GEN_CAP_BY_ROLE.usuario
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number } // countdown até o próximo slot na janela deslizante

/**
 * Decide se cabe MAIS uma geração. `recentAt` são os `created_at` das gerações ai_generated do
 * usuário (qualquer janela — filtramos a 24h aqui). `cap = Infinity` (admin) ⇒ sempre permite.
 * Estourado ⇒ `retryAfterMs` = quando o N-ésimo mais antigo DENTRO da janela sai dela (o slot que
 * libera a próxima). PURO: `now` é injetado (sem `Date.now()` interno).
 */
export function decideImageQuota(input: {
  cap: number
  recentAt: ReadonlyArray<Date>
  now: Date
}): QuotaDecision {
  const { cap, recentAt, now } = input
  if (!Number.isFinite(cap)) return { allowed: true } // admin ∞
  // Teto ZERO/negativo (config futura #134 pode zerar um papel) ⇒ NUNCA permite; countdown = janela
  // cheia (não há slot que libere antes). Sem esta guarda, o `idx` viraria negativo e o cálculo NaN.
  if (cap <= 0) return { allowed: false, retryAfterMs: IMAGE_GEN_WINDOW_MS }

  const nowMs = now.getTime()
  const windowStart = nowMs - IMAGE_GEN_WINDOW_MS
  const inWindow = recentAt
    .map((d) => d.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b)

  if (inWindow.length < cap) return { allowed: true }

  // Estourou: pra caber mais uma, (inWindow.length - cap + 1) das mais antigas precisam expirar; a
  // (inWindow.length - cap)-ésima (0-based) é a que, ao sair da janela, libera o slot.
  const idx = inWindow.length - cap
  const freesAt = inWindow[idx] + IMAGE_GEN_WINDOW_MS
  return { allowed: false, retryAfterMs: Math.max(0, freesAt - nowMs) }
}

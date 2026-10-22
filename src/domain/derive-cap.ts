/**
 * Teto DIÁRIO de Derivar/Clonar por papel (#588, ADR-0045 emenda 2026-10-22) — PURO.
 *
 * Teto ANTI-ABUSO, não de produto: cada derivada é uma Receita nova (linha + traduções + ingredientes)
 * e uma chamada paga ao embedder (#119). Uso legítimo — copiar algumas receitas pra ajustar — nunca
 * chega perto; o teto só segura um script clonando o pool em laço. Por isso fica EM CÓDIGO (sem
 * coluna em `app_config`, sem tabela pro): mudar o número é deploy, como a Sugestão de cardápio.
 *
 * A JANELA não mora aqui: é a mesma das cotas de IA (`RECIPE_GEN_WINDOW_MS`, 24h deslizante) e a
 * decisão é `decideRecipeGenQuota` — fonte ÚNICA do cálculo. O gate atômico (lock + recontagem das
 * `user_edited` vivas do usuário) é `assertDeriveSlotInTx` em `@/server/quota/atomic`.
 */

import type { Role } from '@/domain/user'

/**
 * Derivadas+clones por papel em qualquer janela de 24h. `null` = ilimitado. Curador ganha o dobro:
 * revisar/consertar receitas do pool passa por forkar (a ação de moderação nunca edita a base).
 */
export const DERIVE_CAP_BY_ROLE: Record<Role, number | null> = {
  usuario: 30,
  curador: 60,
  admin: null,
}

/** Teto numérico do papel. Papel desconhecido ⇒ o de `usuario` (fail-closed). `null` ⇒ `Infinity`. */
export function capForDerive(role: Role | null | undefined): number {
  const raw =
    role != null && Object.hasOwn(DERIVE_CAP_BY_ROLE, role) ? DERIVE_CAP_BY_ROLE[role] : DERIVE_CAP_BY_ROLE.usuario
  return raw == null ? Infinity : raw
}

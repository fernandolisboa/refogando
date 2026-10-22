import { describe, expect, it } from 'vitest'
import { DERIVE_CAP_BY_ROLE, capForDerive } from '@/domain/derive-cap'
import { RECIPE_GEN_WINDOW_MS, decideRecipeGenQuota } from '@/domain/recipe-gen-quota'

/**
 * Teto de Derivar/Clonar por papel (#588). A janela/decisão é a das cotas de IA (`decideRecipeGenQuota`,
 * já coberta em recipe-gen-quota.test.ts); aqui só a resolução do teto + o cenário do número real.
 */
describe('capForDerive', () => {
  it('teto por papel: usuario 30, curador 60, admin ∞', () => {
    expect(capForDerive('usuario')).toBe(30)
    expect(capForDerive('curador')).toBe(60)
    expect(capForDerive('admin')).toBe(Infinity)
  })

  it('papel desconhecido/null ⇒ teto de usuario (fail-closed)', () => {
    expect(capForDerive(null)).toBe(DERIVE_CAP_BY_ROLE.usuario)
    expect(capForDerive(undefined)).toBe(DERIVE_CAP_BY_ROLE.usuario)
    expect(capForDerive('root' as never)).toBe(DERIVE_CAP_BY_ROLE.usuario)
    // Chave herdada de Object.prototype não é papel.
    expect(capForDerive('toString' as never)).toBe(DERIVE_CAP_BY_ROLE.usuario)
  })

  it('com o teto do usuario: a 31ª derivada em 24h estoura; a mais antiga saindo da janela libera', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    const cap = capForDerive('usuario')
    // 30 derivadas, uma por minuto, a mais antiga há 23h.
    const oldest = now.getTime() - 23 * 60 * 60_000
    const recentAt = Array.from({ length: cap }, (_, i) => new Date(oldest + i * 60_000))
    const d = decideRecipeGenQuota({ cap, recentAt, now })
    expect(d).toEqual({ allowed: false, retryAfterMs: oldest + RECIPE_GEN_WINDOW_MS - now.getTime() })
    expect(decideRecipeGenQuota({ cap, recentAt: recentAt.slice(1), now })).toEqual({ allowed: true })
  })
})

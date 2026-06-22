import { describe, expect, it } from 'vitest'
import { decideRecipeGenQuota, RECIPE_GEN_WINDOW_MS } from '@/domain/recipe-gen-quota'

/**
 * Teto de geração de RECEITA por IA — janela 24h DESLIZANTE (#167). PURO/total. `now` injetado.
 * Espelha o teste de `decideImageQuota` (mesma máquina), variando papéis/limiares/contagens.
 */

const NOW = new Date('2026-06-22T12:00:00Z')
/** Date a `h` horas ATRÁS de NOW. */
function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000)
}

describe('decideRecipeGenQuota — janela 24h deslizante', () => {
  it('cap ∞ (admin/ilimitado) sempre permite, mesmo com muitas gerações recentes', () => {
    const recentAt = [hoursAgo(1), hoursAgo(2), hoursAgo(3), hoursAgo(4), hoursAgo(5)]
    expect(decideRecipeGenQuota({ cap: Infinity, recentAt, now: NOW })).toEqual({ allowed: true })
  })

  it('abaixo do teto ⇒ permite', () => {
    expect(decideRecipeGenQuota({ cap: 10, recentAt: [hoursAgo(1), hoursAgo(2)], now: NOW })).toEqual({
      allowed: true,
    })
  })

  it('zero gerações ⇒ permite', () => {
    expect(decideRecipeGenQuota({ cap: 10, recentAt: [], now: NOW })).toEqual({ allowed: true })
  })

  it('1 abaixo do teto ⇒ ainda permite (cap=3, 2 na janela)', () => {
    expect(decideRecipeGenQuota({ cap: 3, recentAt: [hoursAgo(1), hoursAgo(2)], now: NOW })).toEqual({
      allowed: true,
    })
  })

  it('no teto (3 na janela, cap=3) ⇒ bloqueia; countdown = a mais antiga + 24h', () => {
    const recentAt = [hoursAgo(1), hoursAgo(10), hoursAgo(20)] // a mais antiga: 20h atrás
    const d = decideRecipeGenQuota({ cap: 3, recentAt, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      // libera quando a de 20h atrás sai da janela ⇒ ~4h (24-20).
      expect(d.retryAfterMs).toBe(4 * 60 * 60 * 1000)
    }
  })

  it('gerações FORA da janela (>24h) não contam', () => {
    const recentAt = [hoursAgo(25), hoursAgo(30), hoursAgo(1)] // só a de 1h conta
    expect(decideRecipeGenQuota({ cap: 3, recentAt, now: NOW })).toEqual({ allowed: true })
  })

  it('com mais que o teto na janela, libera quando a (N-cap)-ésima mais antiga expira', () => {
    // cap=3, 4 na janela (a mais antiga 23h): pra caber +1, as 2 mais antigas precisam sair;
    // a 2ª mais antiga (22h) libera o slot ⇒ ~2h.
    const recentAt = [hoursAgo(23), hoursAgo(22), hoursAgo(5), hoursAgo(1)]
    const d = decideRecipeGenQuota({ cap: 3, recentAt, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterMs).toBe(2 * 60 * 60 * 1000)
  })

  it('teto maior (usuario default 10): 9 na janela ainda cabe; 10 estoura', () => {
    const nine = Array.from({ length: 9 }, (_, i) => hoursAgo(i + 1))
    expect(decideRecipeGenQuota({ cap: 10, recentAt: nine, now: NOW })).toEqual({ allowed: true })
    const ten = Array.from({ length: 10 }, (_, i) => hoursAgo(i + 1))
    expect(decideRecipeGenQuota({ cap: 10, recentAt: ten, now: NOW }).allowed).toBe(false)
  })

  it('cap 0 (papel zerado) ⇒ NUNCA permite; countdown = janela cheia (sem NaN)', () => {
    const d = decideRecipeGenQuota({ cap: 0, recentAt: [], now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterMs).toBe(RECIPE_GEN_WINDOW_MS)
  })

  it('RECIPE_GEN_WINDOW_MS é 24h', () => {
    expect(RECIPE_GEN_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })
})

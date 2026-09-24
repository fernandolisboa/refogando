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

describe('decideRecipeGenQuota — "gerar 2" exige 2 slots via cap REDUZIDO (#423)', () => {
  // A borda (route) reusa a máquina de 1-slot com `cap - 1` p/ exigir 2 slots livres: permitido sob
  // cap-1 ⟺ cabem 2 (inWindow < cap-1 ⟺ inWindow+2 <= cap). Estes casos travam essa equivalência.
  const dois = (cap: number, recentAt: Date[]) => decideRecipeGenQuota({ cap: cap - 1, recentAt, now: NOW })

  it('cap=10, 8 na janela → cabem 2 (permite); 9 na janela → não cabem 2 (bloqueia)', () => {
    const oito = Array.from({ length: 8 }, (_, i) => hoursAgo(i + 1))
    expect(dois(10, oito)).toEqual({ allowed: true }) // 8+2 = 10 <= 10
    const nove = Array.from({ length: 9 }, (_, i) => hoursAgo(i + 1))
    expect(dois(10, nove).allowed).toBe(false) // 9+2 = 11 > 10
  })

  it('cap=2, 0 na janela → cabem exatamente 2 (permite)', () => {
    expect(dois(2, [])).toEqual({ allowed: true })
  })

  it('cap=2, 1 na janela → NÃO cabem 2 (bloqueia)', () => {
    expect(dois(2, [hoursAgo(3)]).allowed).toBe(false)
  })

  it('cap=1 (papel quase zerado) → NUNCA cabem 2 (cap-1=0 ⇒ bloqueia sempre)', () => {
    const d = dois(1, [])
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterMs).toBe(RECIPE_GEN_WINDOW_MS)
  })
})

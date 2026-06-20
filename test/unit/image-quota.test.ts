import { describe, expect, it } from 'vitest'
import { decideImageQuota, IMAGE_GEN_WINDOW_MS } from '@/domain/image-quota'

/**
 * Teto de geração por IA — janela 24h DESLIZANTE (#132, ADR-0017). PURO/total. `now` injetado.
 * (A resolução do cap por papel migrou p/ `image-gen-config.test.ts` na #134 — `capFromConfig`.)
 */

const NOW = new Date('2026-06-20T12:00:00Z')
/** Date a `h` horas ATRÁS de NOW. */
function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000)
}

describe('decideImageQuota — janela 24h deslizante', () => {
  it('admin (∞) sempre permite, mesmo com muitas gerações recentes', () => {
    const recentAt = [hoursAgo(1), hoursAgo(2), hoursAgo(3), hoursAgo(4), hoursAgo(5)]
    expect(decideImageQuota({ cap: Infinity, recentAt, now: NOW })).toEqual({ allowed: true })
  })

  it('abaixo do teto ⇒ permite', () => {
    expect(decideImageQuota({ cap: 3, recentAt: [hoursAgo(1), hoursAgo(2)], now: NOW })).toEqual({ allowed: true })
  })

  it('zero gerações ⇒ permite', () => {
    expect(decideImageQuota({ cap: 3, recentAt: [], now: NOW })).toEqual({ allowed: true })
  })

  it('no teto (3 na janela) ⇒ bloqueia; countdown = a mais antiga + 24h', () => {
    const recentAt = [hoursAgo(1), hoursAgo(10), hoursAgo(20)] // a mais antiga: 20h atrás
    const d = decideImageQuota({ cap: 3, recentAt, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      // libera quando a de 20h atrás sai da janela ⇒ ~4h (24-20).
      expect(d.retryAfterMs).toBe(4 * 60 * 60 * 1000)
    }
  })

  it('gerações FORA da janela (>24h) não contam', () => {
    const recentAt = [hoursAgo(25), hoursAgo(30), hoursAgo(1)] // só a de 1h conta
    expect(decideImageQuota({ cap: 3, recentAt, now: NOW })).toEqual({ allowed: true })
  })

  it('com mais que o teto na janela, libera quando a (N-cap)-ésima mais antiga expira', () => {
    // cap=3, 4 na janela (a mais antiga 23h): pra caber +1, as 2 mais antigas precisam sair;
    // a 2ª mais antiga (22h) libera o slot ⇒ ~2h.
    const recentAt = [hoursAgo(23), hoursAgo(22), hoursAgo(5), hoursAgo(1)]
    const d = decideImageQuota({ cap: 3, recentAt, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterMs).toBe(2 * 60 * 60 * 1000)
  })

  it('cap 0 (config futura pode zerar um papel) ⇒ NUNCA permite; countdown = janela cheia (sem NaN)', () => {
    const d = decideImageQuota({ cap: 0, recentAt: [], now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterMs).toBe(IMAGE_GEN_WINDOW_MS)
  })

  it('IMAGE_GEN_WINDOW_MS é 24h', () => {
    expect(IMAGE_GEN_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })
})

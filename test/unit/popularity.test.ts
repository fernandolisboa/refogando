import { describe, expect, it } from 'vitest'
import {
  frescor,
  bayesianRating,
  popularityScore,
  cookScore,
  parsePopularityConfig,
  DEFAULT_POPULARITY_CONFIG,
  type PopularityConfig,
} from '@/domain/popularity'

/**
 * Popularidade (#368, ADR-0027/0028) — módulo PURO, exaustivo. `frescor` (decay exponencial),
 * `bayesianRating` (shrinkage pra média global C), `popularityScore` (receita, com frescor) e
 * `cookScore` (cozinheiro, SEM frescor aditivo — recência vira desempate no keyset), mais o
 * `parsePopularityConfig` do PUT do admin.
 *
 * NOTA DE DESIGN (guarda-corpo (a), achado math M1): C = média GLOBAL das notas (ADR-literal;
 * guarda-corpo (b): receita nova senta em ≈C, nunca afunda). Com C alto (≥~4,47, típico de site de
 * receitas) a Bayesiana ISOLADA dá vantagem ínfima ao 5★/1 sobre o 4,5★/200 (quando R=C, o de alto
 * volume fica exatamente em C, sem headroom). Isso é CORRETO: o guarda-corpo (a) é o PRINCÍPIO
 * "confiança-por-volume = shrinkage pra C" (o 5★/1 é PUXADO pra perto de C, longe de 5). A fila real
 * é carregada pelo SINAL DE SAVES (abundante, low-friction — o racional do ADR "Save evita cold-start").
 * Por isso testamos (i) o PRINCÍPIO do shrinkage e (ii) a ordem no SCORE COMPLETO com saves realistas —
 * NÃO o teste isolado-Bayesiano enganoso com C baixo. Baixar o prior é emenda de ADR (deferido).
 */

describe('frescor — decay exponencial (0,1]', () => {
  it('ageDays<=0 ⇒ 1 (clamp de skew de relógio)', () => {
    expect(frescor(0, 30)).toBe(1)
    expect(frescor(-5, 30)).toBe(1)
  })

  it('decresce monotonicamente com a idade', () => {
    expect(frescor(10, 30)).toBeGreaterThan(frescor(20, 30))
    expect(frescor(20, 30)).toBeGreaterThan(frescor(60, 30))
  })

  it('em tau, vale exp(-1) ≈ 0,3679', () => {
    expect(frescor(30, 30)).toBeCloseTo(Math.exp(-1), 10)
  })

  it('idade grande ⇒ ~0 (positivo, tende a zero); idade enorme ⇒ underflow p/ 0 (≥0, nunca <0)', () => {
    // 10·tau ainda é > 0 em float64 (exp(-10) ≈ 4,5e-5) — o decay é suave, não trava.
    const moderada = frescor(300, 30)
    expect(moderada).toBeGreaterThan(0)
    expect(moderada).toBeLessThan(1e-4)
    // idade extrema: exp(-3333) faz underflow pra 0 exato em float64 — matematicamente em [0,1],
    // NUNCA negativo. O limite superior nunca passa de 1.
    const enorme = frescor(100_000, 30)
    expect(enorme).toBeGreaterThanOrEqual(0)
    expect(enorme).toBeLessThan(1e-6)
    expect(frescor(1, 30)).toBeLessThanOrEqual(1)
  })
})

describe('bayesianRating — shrinkage pra C', () => {
  it('v=0 ⇒ exatamente C (sem sinal ⇒ prior puro)', () => {
    expect(bayesianRating(5, 0, 3, 20)).toBe(3)
    expect(bayesianRating(1, 0, 4.5, 20)).toBe(4.5)
  })

  it('v→∞ ⇒ converge pra R (o sinal domina o prior)', () => {
    expect(bayesianRating(5, 1_000_000, 3, 20)).toBeCloseTo(5, 4)
  })

  it('monotônico em v na direção de R (R>C ⇒ cresce; R<C ⇒ cai)', () => {
    expect(bayesianRating(5, 1, 3, 20)).toBeLessThan(bayesianRating(5, 10, 3, 20))
    expect(bayesianRating(5, 10, 3, 20)).toBeLessThan(bayesianRating(5, 100, 3, 20))
    expect(bayesianRating(1, 1, 3, 20)).toBeGreaterThan(bayesianRating(1, 10, 3, 20))
  })

  it('parametrizado: fórmula (v/(v+m))·R + (m/(v+m))·C', () => {
    const R = 4,
      v = 5,
      C = 3,
      m = 20
    expect(bayesianRating(R, v, C, m)).toBeCloseTo((v / (v + m)) * R + (m / (v + m)) * C, 12)
  })

  // GUARDA-CORPO (a) — o PRINCÍPIO (shrinkage forte), não o isolado enganoso.
  it('guarda-corpo (a): 5★/1 com C=4,5 fica DENTRO de ~0,05 de C (puxado pra C, longe de 5)', () => {
    const shrunk = bayesianRating(5, 1, 4.5, 20)
    expect(Math.abs(shrunk - 4.5)).toBeLessThan(0.05)
    expect(shrunk).toBeLessThan(4.6) // muito longe de 5
  })
})

describe('popularityScore — score de RECEITA (com frescor)', () => {
  const cfg = DEFAULT_POPULARITY_CONFIG

  it('guarda-corpo (a) no SCORE COMPLETO: 4,5★/200 com MAIS saves supera 5★/1 (cenário realista)', () => {
    // Mesma idade pros dois ⇒ o frescor não distorce; o sinal de saves + o volume de notas mandam.
    const consagrada = popularityScore({
      saves: 50,
      ratingAvg: 4.5,
      ratingCount: 200,
      ageDays: 0,
      globalAvg: 4.5,
      config: cfg,
    })
    const cauda = popularityScore({
      saves: 2,
      ratingAvg: 5,
      ratingCount: 1,
      ageDays: 0,
      globalAvg: 4.5,
      config: cfg,
    })
    expect(consagrada).toBeGreaterThan(cauda)
  })

  it('mais saves ⇒ score maior (tudo mais igual)', () => {
    const base = { ratingAvg: 4, ratingCount: 10, ageDays: 5, globalAvg: 4, config: cfg }
    expect(popularityScore({ ...base, saves: 100 })).toBeGreaterThan(
      popularityScore({ ...base, saves: 3 }),
    )
  })

  it('guarda-corpo (b): 0 sinal = wNota·C + wNovo·frescor(0) = C + wNovo (≥0, nunca negativa)', () => {
    const C = 4.5
    const zero = popularityScore({
      saves: 0,
      ratingAvg: 0,
      ratingCount: 0,
      ageDays: 0,
      globalAvg: C,
      config: cfg,
    })
    expect(zero).toBeCloseTo(cfg.wNota * C + cfg.wNovo * 1, 10)
    expect(zero).toBeGreaterThan(0)
  })

  it('guarda-corpo (b): a NOVA (recente) supera a ANTIGA de 0-sinal (frescor→0)', () => {
    const base = { saves: 0, ratingAvg: 0, ratingCount: 0, globalAvg: 4.5, config: cfg }
    const nova = popularityScore({ ...base, ageDays: 0 })
    const antiga = popularityScore({ ...base, ageDays: 365 })
    expect(nova).toBeGreaterThan(antiga)
  })

  it('nunca negativa com C baixo e zero sinal', () => {
    const s = popularityScore({
      saves: 0,
      ratingAvg: 0,
      ratingCount: 0,
      ageDays: 10,
      globalAvg: 3,
      config: cfg,
    })
    expect(s).toBeGreaterThanOrEqual(0)
  })

  it('saves negativo (defensivo) é clampado a 0', () => {
    const withNeg = popularityScore({
      saves: -5,
      ratingAvg: 0,
      ratingCount: 0,
      ageDays: 0,
      globalAvg: 3,
      config: cfg,
    })
    const withZero = popularityScore({
      saves: 0,
      ratingAvg: 0,
      ratingCount: 0,
      ageDays: 0,
      globalAvg: 3,
      config: cfg,
    })
    expect(withNeg).toBe(withZero)
  })
})

describe('cookScore — score de COZINHEIRO (SEM frescor aditivo)', () => {
  const cfg = DEFAULT_POPULARITY_CONFIG

  it('0 sinal = wNota·C (constante; recência desempata no keyset, não no score)', () => {
    const C = 4.2
    expect(cookScore({ saves: 0, ratingAvg: 0, ratingCount: 0, globalAvg: C, config: cfg })).toBeCloseTo(
      cfg.wNota * C,
      10,
    )
  })

  it('NÃO depende de tempo: é popularityScore SEM o termo de frescor', () => {
    const input = { saves: 10, ratingAvg: 4.5, ratingCount: 40, globalAvg: 4.5, config: cfg }
    const cs = cookScore(input)
    const expected =
      cfg.wSave * Math.log(1 + 10) + cfg.wNota * bayesianRating(4.5, 40, 4.5, cfg.m)
    expect(cs).toBeCloseTo(expected, 10)
  })

  it('mais saves ⇒ score maior', () => {
    const base = { ratingAvg: 4, ratingCount: 10, globalAvg: 4, config: cfg }
    expect(cookScore({ ...base, saves: 50 })).toBeGreaterThan(cookScore({ ...base, saves: 1 }))
  })
})

describe('parsePopularityConfig — validação do PUT', () => {
  const valid: PopularityConfig = { wSave: 1, wNota: 1, wNovo: 0.5, m: 20, tauDays: 30 }

  it('objeto válido ⇒ ok com o valor', () => {
    const r = parsePopularityConfig(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual(valid)
  })

  it('o DEFAULT passa a própria validação (round-trip)', () => {
    expect(parsePopularityConfig(DEFAULT_POPULARITY_CONFIG).ok).toBe(true)
  })

  it('aceita peso 0 (desliga um termo)', () => {
    expect(parsePopularityConfig({ ...valid, wSave: 0, wNovo: 0 }).ok).toBe(true)
  })

  it('rejeita Infinity em QUALQUER campo (o caso que passa o naive `>0`)', () => {
    expect(parsePopularityConfig({ ...valid, wSave: Infinity }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, wNota: Infinity }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, wNovo: Infinity }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, m: Infinity }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, tauDays: Infinity }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, m: -Infinity }).ok).toBe(false)
  })

  it('rejeita NaN em qualquer campo', () => {
    expect(parsePopularityConfig({ ...valid, wSave: NaN }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, m: NaN }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, tauDays: NaN }).ok).toBe(false)
  })

  it('rejeita peso negativo', () => {
    expect(parsePopularityConfig({ ...valid, wSave: -1 }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, wNota: -0.1 }).ok).toBe(false)
  })

  it('rejeita m<=0 (desliga o guarda-corpo (a): sem shrinkage) e tau<=0', () => {
    expect(parsePopularityConfig({ ...valid, m: 0 }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, m: -5 }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, tauDays: 0 }).ok).toBe(false)
    expect(parsePopularityConfig({ ...valid, tauDays: -1 }).ok).toBe(false)
  })

  it('rejeita string/tipo errado e campo faltando', () => {
    expect(parsePopularityConfig({ ...valid, wSave: '1' }).ok).toBe(false)
    expect(parsePopularityConfig({ wSave: 1, wNota: 1, wNovo: 0.5, m: 20 }).ok).toBe(false) // sem tauDays
    expect(parsePopularityConfig({ wNota: 1, wNovo: 0.5, m: 20, tauDays: 30 }).ok).toBe(false) // sem wSave
  })

  it('rejeita não-objeto / null / array', () => {
    expect(parsePopularityConfig(null).ok).toBe(false)
    expect(parsePopularityConfig('x').ok).toBe(false)
    expect(parsePopularityConfig(42).ok).toBe(false)
    expect(parsePopularityConfig([valid]).ok).toBe(false)
  })
})

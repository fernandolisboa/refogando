import { describe, it, expect } from 'vitest'
import { createDomainRateLimiter } from '@/server/import/rate-limit'

/**
 * Rate-limit de POLITENESS por domínio da importação (#272, ADR-0019). Módulo PURO com clock INJETÁVEL
 * — testável sem sleep real. NÃO é uma quota dura: in-memory por-instância no Vercel é best-effort
 * (documentado no módulo); aqui provamos a lógica da janela deslizante de forma determinística.
 */

/** Relógio falso controlável (o módulo aceita `now()` injetado). */
function fixedClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('createDomainRateLimiter (#272) — janela por domínio com clock injetável', () => {
  it('1ª chamada de um domínio → permitida', () => {
    const rl = createDomainRateLimiter({ now: fixedClock().now })
    expect(rl.tryAcquire('a.com')).toBe(true)
  })

  it('2ª chamada do MESMO domínio dentro da janela → bloqueada (sem sleep real)', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true)
    clock.advance(500)
    expect(rl.tryAcquire('a.com')).toBe(false)
  })

  it('após a janela expirar (>= minIntervalMs) → permitida de novo', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true)
    clock.advance(1000)
    expect(rl.tryAcquire('a.com')).toBe(true)
  })

  it('no LIMITE EXATO (elapsed === minIntervalMs) → permitida (regra é >=)', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ minIntervalMs: 1000, now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true)
    clock.advance(1000)
    expect(rl.tryAcquire('a.com')).toBe(true)
  })

  it('uma tentativa BLOQUEADA não estende a janela (registra SÓ no sucesso)', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true) // @0 ok (janela conta daqui)
    clock.advance(500)
    expect(rl.tryAcquire('a.com')).toBe(false) // @500 bloqueada — NÃO reinicia a janela
    clock.advance(500)
    expect(rl.tryAcquire('a.com')).toBe(true) // @1000: 1000ms desde o @0 (não desde o @500)
  })

  it('domínios diferentes são independentes', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true)
    expect(rl.tryAcquire('b.com')).toBe(true) // b não é afetado por a
    expect(rl.tryAcquire('a.com')).toBe(false) // a ainda dentro da janela
  })

  it('minIntervalMs customizado é respeitado', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ minIntervalMs: 200, now: clock.now })
    expect(rl.tryAcquire('a.com')).toBe(true)
    clock.advance(150)
    expect(rl.tryAcquire('a.com')).toBe(false)
    clock.advance(50)
    expect(rl.tryAcquire('a.com')).toBe(true) // 200ms acumulados
  })

  it('a poda (delete durante for..of do Map) remove os stale e NÃO corrompe entradas vivas', () => {
    const clock = fixedClock()
    const rl = createDomainRateLimiter({ now: clock.now })
    rl.tryAcquire('stale1.com')
    rl.tryAcquire('stale2.com')
    rl.tryAcquire('stale3.com')
    clock.advance(1000) // os três saem da janela
    expect(rl.tryAcquire('vivo.com')).toBe(true) // entra agora (e a poda varre os stale*)
    clock.advance(500) // vivo.com ainda dentro da janela
    // Adquirir outro domínio força a poda a iterar o Map de novo; vivo.com deve sobreviver intacto.
    expect(rl.tryAcquire('outro.com')).toBe(true)
    expect(rl.tryAcquire('vivo.com')).toBe(false) // a poda não removeu nem corrompeu a entrada viva
  })
})

import { describe, expect, it } from 'vitest'
import { formatCountdown } from '@/lib/countdown'

/** Countdown do 429 de cota (#132 imagem, #588 derivar): minutos abaixo de 1h, horas (pra cima) acima. */
describe('formatCountdown', () => {
  it('abaixo de 1h ⇒ minutos arredondados pra cima; nunca 0', () => {
    expect(formatCountdown(0)).toBe('1min')
    expect(formatCountdown(61_000)).toBe('2min')
    expect(formatCountdown(59 * 60_000)).toBe('59min')
  })

  it('1h ou mais ⇒ horas arredondadas pra cima', () => {
    expect(formatCountdown(60 * 60_000)).toBe('1h')
    expect(formatCountdown(90 * 60_000)).toBe('2h')
    expect(formatCountdown(23.5 * 60 * 60_000)).toBe('24h')
  })
})

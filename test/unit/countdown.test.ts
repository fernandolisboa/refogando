import { describe, expect, it } from 'vitest'
import { formatCountdown, readDeriveLimit } from '@/lib/countdown'

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

/** O 429 do teto de Derivar/Clonar (#588), lido igual pelo "Clonar" e pelo modal de derivar. */
describe('readDeriveLimit', () => {
  const res = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

  it('429 limite_derivar ⇒ countdown formatado', async () => {
    expect(await readDeriveLimit(res(429, { error: 'limite_derivar', retryAfterMs: 90 * 60_000 }))).toBe('2h')
    expect(await readDeriveLimit(res(429, { error: 'limite_derivar' }))).toBe('1min')
  })

  it('outro status, outro erro ou corpo ilegível ⇒ null (mensagem neutra do caller)', async () => {
    expect(await readDeriveLimit(res(500, { error: 'limite_derivar', retryAfterMs: 1 }))).toBeNull()
    expect(await readDeriveLimit(res(429, { error: 'outra_coisa', retryAfterMs: 1 }))).toBeNull()
    expect(await readDeriveLimit(res(429, '{nao-json'))).toBeNull()
  })
})

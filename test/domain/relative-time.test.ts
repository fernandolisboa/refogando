import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime, formatRelativeTime } from '@/domain/relative-time'

/** Tempo relativo das notificações e da lista de usuários: até uma semana relativo, depois a data. */
const NOW = Date.parse('2026-10-23T12:00:00Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()

describe('formatRelativeTime', () => {
  it('menos de um minuto ⇒ "agora" / "now"', () => {
    expect(formatRelativeTime(ago(0), NOW, 'pt-BR')).toBe('agora')
    expect(formatRelativeTime(ago(59), NOW, 'pt-BR')).toBe('agora')
    expect(formatRelativeTime(ago(30), NOW, 'en-US')).toBe('now')
  })

  it('minutos, horas e dias em pt-BR e en-US', () => {
    expect(formatRelativeTime(ago(60), NOW, 'pt-BR')).toBe('há 1 minuto')
    expect(formatRelativeTime(ago(2 * 60), NOW, 'pt-BR')).toBe('há 2 minutos')
    expect(formatRelativeTime(ago(3 * 3600), NOW, 'pt-BR')).toBe('há 3 horas')
    expect(formatRelativeTime(ago(2 * 86400), NOW, 'pt-BR')).toBe('há 2 dias')
    expect(formatRelativeTime(ago(2 * 60), NOW, 'en-US')).toBe('2 minutes ago')
    expect(formatRelativeTime(ago(3 * 3600), NOW, 'en-US')).toBe('3 hours ago')
    expect(formatRelativeTime(ago(2 * 86400), NOW, 'en-US')).toBe('2 days ago')
  })

  it('trunca a unidade: 59 min 59 s é "há 59 minutos"; 25 h é "há 1 dia", nunca "ontem"', () => {
    expect(formatRelativeTime(ago(3599), NOW, 'pt-BR')).toBe('há 59 minutos')
    expect(formatRelativeTime(ago(23 * 3600 + 59 * 60), NOW, 'pt-BR')).toBe('há 23 horas')
    expect(formatRelativeTime(ago(25 * 3600), NOW, 'pt-BR')).toBe('há 1 dia')
    expect(formatRelativeTime(ago(7 * 86400 - 1), NOW, 'pt-BR')).toBe('há 6 dias')
  })

  it('uma semana ou mais ⇒ a data no locale', () => {
    const iso = ago(7 * 86400)
    expect(formatRelativeTime(iso, NOW, 'pt-BR')).toBe(formatDate(iso, 'pt-BR'))
    expect(formatRelativeTime('2026-01-05T12:00:00Z', NOW, 'pt-BR')).toBe('5 de jan. de 2026')
    expect(formatRelativeTime('2026-01-05T12:00:00Z', NOW, 'en-US')).toBe('Jan 5, 2026')
  })

  it('instante no futuro (relógio do aparelho atrasado) ⇒ "agora"', () => {
    expect(formatRelativeTime(ago(-5 * 60), NOW, 'pt-BR')).toBe('agora')
  })

  it('data inválida ⇒ "" nas três funções (sem RangeError)', () => {
    expect(formatRelativeTime('não é data', NOW, 'pt-BR')).toBe('')
    expect(formatDate('', 'pt-BR')).toBe('')
    expect(formatDateTime('xyz', 'en-US')).toBe('')
  })
})

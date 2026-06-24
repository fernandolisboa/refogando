import { describe, it, expect } from 'vitest'
import { conciliarTempoPreparo, formatDuracao } from '@/domain/tempo'

describe('conciliarTempoPreparo (ADR-0023 dec.3 — salva descartando o ativo incoerente)', () => {
  it('mantém ambos quando ativo ≤ total', () => {
    expect(conciliarTempoPreparo(20, 90)).toEqual({ tempoAtivoMin: 20, tempoTotalMin: 90 })
    expect(conciliarTempoPreparo(90, 90)).toEqual({ tempoAtivoMin: 90, tempoTotalMin: 90 })
  })

  it('descarta o ativo quando ativo > total (mantém o total, NÃO invalida)', () => {
    expect(conciliarTempoPreparo(150, 120)).toEqual({ tempoAtivoMin: null, tempoTotalMin: 120 })
  })

  it('descarta o ativo quando há ativo sem total (ativo-sozinho é impossível pelo CHECK)', () => {
    expect(conciliarTempoPreparo(30, null)).toEqual({ tempoAtivoMin: null, tempoTotalMin: null })
    expect(conciliarTempoPreparo(30, undefined)).toEqual({
      tempoAtivoMin: null,
      tempoTotalMin: null,
    })
  })

  it('aceita só o total (ativo ausente)', () => {
    expect(conciliarTempoPreparo(null, 60)).toEqual({ tempoAtivoMin: null, tempoTotalMin: 60 })
    expect(conciliarTempoPreparo(undefined, 60)).toEqual({ tempoAtivoMin: null, tempoTotalMin: 60 })
  })

  it('ambos ausentes → ambos null', () => {
    expect(conciliarTempoPreparo(null, null)).toEqual({ tempoAtivoMin: null, tempoTotalMin: null })
  })

  it('é idempotente (reaplicar no resultado não muda)', () => {
    const once = conciliarTempoPreparo(150, 120)
    expect(conciliarTempoPreparo(once.tempoAtivoMin, once.tempoTotalMin)).toEqual(once)
  })
})

describe('formatDuracao', () => {
  it('formata horas + minutos, omitindo o componente zero', () => {
    expect(formatDuracao(90)).toBe('1 h 30 min')
    expect(formatDuracao(60)).toBe('1 h')
    expect(formatDuracao(45)).toBe('45 min')
    expect(formatDuracao(125)).toBe('2 h 5 min')
    expect(formatDuracao(1)).toBe('1 min')
  })

  it('ausente (null / 0 / negativo) → string vazia', () => {
    expect(formatDuracao(null)).toBe('')
    expect(formatDuracao(undefined)).toBe('')
    expect(formatDuracao(0)).toBe('')
    expect(formatDuracao(-5)).toBe('')
  })
})

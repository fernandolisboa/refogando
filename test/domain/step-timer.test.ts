import { describe, it, expect } from 'vitest'
import { parseStepTimer } from '@/domain/step-timer'

/**
 * `parseStepTimer` (#455) — heurístico EFÊMERO de parsing sobre o TEXTO do passo, nunca dado
 * persistido (ADR-0023 landmine: tempo-por-passo é proibido como coluna/campo).
 */
describe('parseStepTimer — timer efêmero a partir do texto do passo (#455)', () => {
  it('reconhece minutos (pt-BR): "asse por 20 minutos" → 20', () => {
    expect(parseStepTimer('Asse por 20 minutos')).toEqual({ minutes: 20 })
  })

  it('reconhece "min" abreviado: "cozinhe por 5 min"', () => {
    expect(parseStepTimer('Cozinhe por 5 min')).toEqual({ minutes: 5 })
  })

  it('reconhece horas: "leve à geladeira por 2 horas" → 120', () => {
    expect(parseStepTimer('Leve à geladeira por 2 horas')).toEqual({ minutes: 120 })
  })

  it('soma horas + minutos na mesma frase: "descanse por 1 hora e 30 minutos" → 90', () => {
    expect(parseStepTimer('Descanse por 1 hora e 30 minutos')).toEqual({ minutes: 90 })
  })

  it('singular "1 hora"/"1 minuto" reconhecido igual ao plural', () => {
    expect(parseStepTimer('Espere 1 hora')).toEqual({ minutes: 60 })
    expect(parseStepTimer('Espere 1 minuto')).toEqual({ minutes: 1 })
  })

  it('en-US: "bake for 20 minutes"/"chill for 2 hours"', () => {
    expect(parseStepTimer('Bake for 20 minutes')).toEqual({ minutes: 20 })
    expect(parseStepTimer('Chill for 2 hours')).toEqual({ minutes: 120 })
    expect(parseStepTimer('Rest for 1 hour 30 minutes')).toEqual({ minutes: 90 })
  })

  it('case-insensitive: "ASSE POR 20 MINUTOS"', () => {
    expect(parseStepTimer('ASSE POR 20 MINUTOS')).toEqual({ minutes: 20 })
  })

  it('sem duração reconhecível ⇒ null (não inventa timer)', () => {
    expect(parseStepTimer('Misture os ingredientes secos')).toBeNull()
    expect(parseStepTimer('Corte a cebola em 4 partes')).toBeNull() // número presente, mas sem unidade de tempo
  })

  it('NÃO reconhece "h" nu (evita colidir com horário do relógio, ex. "às 20h")', () => {
    expect(parseStepTimer('Sirva às 20h')).toBeNull()
    expect(parseStepTimer('Descanse por 20h')).toBeNull()
  })

  it('string vazia ⇒ null, nunca lança', () => {
    expect(parseStepTimer('')).toBeNull()
  })
})

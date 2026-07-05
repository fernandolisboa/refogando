import { describe, expect, it } from 'vitest'
import {
  capFromExtractionConfig,
  parseExtractionCapByRole,
  DEFAULT_EXTRACTION_CAP_BY_ROLE,
  type ExtractionCapByRole,
} from '@/domain/extraction-cap-config'

/**
 * Config do teto de EXTRAÇÃO de ingredientes (#447) — PURO. `capFromExtractionConfig` resolve o teto por
 * papel (null=∞, fail-closed) e `parseExtractionCapByRole` valida a entrada do PUT do admin. Espelha
 * `recipe-gen-config.test.ts`, com defaults MAIS FOLGADOS (extração barata via Haiku).
 */

describe('capFromExtractionConfig — teto por papel a partir da config', () => {
  const caps: ExtractionCapByRole = { usuario: 60, curador: 120, admin: null }

  it('papel com número ⇒ o número; null ⇒ Infinity (ilimitado)', () => {
    expect(capFromExtractionConfig(caps, 'usuario')).toBe(60)
    expect(capFromExtractionConfig(caps, 'curador')).toBe(120)
    expect(capFromExtractionConfig(caps, 'admin')).toBe(Infinity)
  })

  it('papel null/desconhecido ⇒ fail-closed no teto de usuario', () => {
    expect(capFromExtractionConfig(caps, null)).toBe(60)
  })

  it('teto 0 (papel zerado) é repassado como 0 (decideRecipeGenQuota o lê como bloqueado)', () => {
    expect(capFromExtractionConfig({ usuario: 0, curador: 120, admin: null }, 'usuario')).toBe(0)
  })

  it('defaults MAIS FOLGADOS que geração: usuario 60, curador 120, admin ∞', () => {
    expect(capFromExtractionConfig(DEFAULT_EXTRACTION_CAP_BY_ROLE, 'usuario')).toBe(60)
    expect(capFromExtractionConfig(DEFAULT_EXTRACTION_CAP_BY_ROLE, 'curador')).toBe(120)
    expect(capFromExtractionConfig(DEFAULT_EXTRACTION_CAP_BY_ROLE, 'admin')).toBe(Infinity)
  })
})

describe('capFromExtractionConfig — eixo plan (#466, scaffold flag-off)', () => {
  const caps: ExtractionCapByRole = { usuario: 60, curador: 120, admin: null }
  const proCaps: ExtractionCapByRole = { usuario: 600, curador: 1200, admin: null }

  it('PARIDADE: sem plano (default free) ⇒ BYTE-IDÊNTICO à resolução por papel de hoje', () => {
    expect(capFromExtractionConfig(caps, 'usuario')).toBe(capFromExtractionConfig(caps, 'usuario', 'free'))
    expect(capFromExtractionConfig(caps, 'curador', 'free')).toBe(120)
    expect(capFromExtractionConfig(caps, 'admin', 'free')).toBe(Infinity)
    expect(capFromExtractionConfig(caps, null, 'free')).toBe(60)
  })

  it('plan=pro SEM proCaps ⇒ cai no teto free (não muda nada agora)', () => {
    expect(capFromExtractionConfig(caps, 'usuario', 'pro')).toBe(60)
  })

  it('plan=pro COM proCaps ⇒ pega o teto pro (Fase 2 configura)', () => {
    expect(capFromExtractionConfig(caps, 'usuario', 'pro', proCaps)).toBe(600)
    expect(capFromExtractionConfig(caps, 'curador', 'pro', proCaps)).toBe(1200)
    expect(capFromExtractionConfig(caps, 'admin', 'pro', proCaps)).toBe(Infinity)
  })

  it('plan=free IGNORA proCaps mesmo se passado', () => {
    expect(capFromExtractionConfig(caps, 'usuario', 'free', proCaps)).toBe(60)
  })
})

describe('parseExtractionCapByRole — validação do PUT', () => {
  it('objeto válido ⇒ devolve o valor normalizado', () => {
    expect(parseExtractionCapByRole({ usuario: 5, curador: 8, admin: null })).toEqual({
      usuario: 5,
      curador: 8,
      admin: null,
    })
  })

  it('defaults passam a própria validação (round-trip)', () => {
    expect(parseExtractionCapByRole(DEFAULT_EXTRACTION_CAP_BY_ROLE)).toEqual(
      DEFAULT_EXTRACTION_CAP_BY_ROLE,
    )
  })

  it('teto 0 é válido (zera o papel)', () => {
    expect(parseExtractionCapByRole({ usuario: 0, curador: 8, admin: null })).toEqual({
      usuario: 0,
      curador: 8,
      admin: null,
    })
  })

  it('rejeita teto negativo / float / NaN / string', () => {
    expect(parseExtractionCapByRole({ usuario: -1, curador: 8, admin: null })).toBeNull()
    expect(parseExtractionCapByRole({ usuario: 2.5, curador: 8, admin: null })).toBeNull()
    expect(parseExtractionCapByRole({ usuario: Number.NaN, curador: 8, admin: null })).toBeNull()
    expect(parseExtractionCapByRole({ usuario: '3', curador: 8, admin: null })).toBeNull()
  })

  it('rejeita papel faltante ou chave estranha', () => {
    expect(parseExtractionCapByRole({ usuario: 2, curador: 4 })).toBeNull()
    expect(parseExtractionCapByRole({ usuario: 2, curador: 4, admin: null, root: 9 })).toBeNull()
  })

  it('rejeita não-objeto / null / array', () => {
    expect(parseExtractionCapByRole(null)).toBeNull()
    expect(parseExtractionCapByRole('x')).toBeNull()
    expect(parseExtractionCapByRole([10, 20, null])).toBeNull()
  })
})

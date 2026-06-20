import { describe, expect, it } from 'vitest'
import {
  capFromConfig,
  parseImageGenConfig,
  isImageGenModel,
  DEFAULT_IMAGE_GEN_CONFIG,
  DEFAULT_IMAGE_GEN_CAP_BY_ROLE,
  DEFAULT_IMAGE_MODEL,
  type ImageGenCapByRole,
} from '@/domain/image-gen-config'

/**
 * Config da geração de imagem (#134) — PURO. `capFromConfig` resolve o teto por papel (null=∞,
 * fail-closed) e `parseImageGenConfig` valida a entrada do PUT do admin. Migrou de capForRole (#132).
 */

describe('capFromConfig — teto por papel a partir da config', () => {
  const caps: ImageGenCapByRole = { usuario: 3, curador: 5, admin: null }

  it('papel com número ⇒ o número; null ⇒ Infinity (ilimitado)', () => {
    expect(capFromConfig(caps, 'usuario')).toBe(3)
    expect(capFromConfig(caps, 'curador')).toBe(5)
    expect(capFromConfig(caps, 'admin')).toBe(Infinity)
  })

  it('papel null/desconhecido ⇒ fail-closed no teto de usuario', () => {
    expect(capFromConfig(caps, null)).toBe(3)
  })

  it('teto 0 (papel zerado) é repassado como 0 (decideImageQuota o lê como bloqueado)', () => {
    expect(capFromConfig({ usuario: 0, curador: 5, admin: null }, 'usuario')).toBe(0)
  })

  it('defaults espelham os fixos da #132 (usuario 3, curador 5, admin ∞)', () => {
    expect(capFromConfig(DEFAULT_IMAGE_GEN_CAP_BY_ROLE, 'usuario')).toBe(3)
    expect(capFromConfig(DEFAULT_IMAGE_GEN_CAP_BY_ROLE, 'curador')).toBe(5)
    expect(capFromConfig(DEFAULT_IMAGE_GEN_CAP_BY_ROLE, 'admin')).toBe(Infinity)
  })
})

describe('isImageGenModel — allowlist', () => {
  it('aceita o default; rejeita desconhecido/não-string', () => {
    expect(isImageGenModel(DEFAULT_IMAGE_MODEL)).toBe(true)
    expect(isImageGenModel('gpt-image-1')).toBe(false)
    expect(isImageGenModel(123)).toBe(false)
    expect(isImageGenModel(null)).toBe(false)
  })
})

describe('parseImageGenConfig — validação do PUT', () => {
  const valid = {
    enabled: true,
    model: DEFAULT_IMAGE_MODEL,
    dailyCapByRole: { usuario: 2, curador: 4, admin: null },
  }

  it('objeto válido ⇒ ok com o valor normalizado', () => {
    const r = parseImageGenConfig(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        enabled: true,
        model: DEFAULT_IMAGE_MODEL,
        dailyCapByRole: { usuario: 2, curador: 4, admin: null },
      })
    }
  })

  it('default config passa a própria validação (round-trip)', () => {
    const r = parseImageGenConfig(DEFAULT_IMAGE_GEN_CONFIG)
    expect(r.ok).toBe(true)
  })

  it('teto 0 é válido (zera o papel)', () => {
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: 0, curador: 4, admin: null } }).ok).toBe(true)
  })

  it('rejeita enabled não-boolean', () => {
    expect(parseImageGenConfig({ ...valid, enabled: 'sim' }).ok).toBe(false)
  })

  it('rejeita modelo fora da allowlist', () => {
    expect(parseImageGenConfig({ ...valid, model: 'gpt-image-1' }).ok).toBe(false)
  })

  it('rejeita teto negativo / float / NaN / string', () => {
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: -1, curador: 4, admin: null } }).ok).toBe(false)
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: 2.5, curador: 4, admin: null } }).ok).toBe(false)
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: '3', curador: 4, admin: null } }).ok).toBe(false)
  })

  it('rejeita papel faltante ou chave estranha', () => {
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: 2, curador: 4 } }).ok).toBe(false)
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: { usuario: 2, curador: 4, admin: null, root: 9 } }).ok).toBe(false)
  })

  it('rejeita não-objeto / null / array', () => {
    expect(parseImageGenConfig(null).ok).toBe(false)
    expect(parseImageGenConfig('x').ok).toBe(false)
    expect(parseImageGenConfig([valid]).ok).toBe(false)
    expect(parseImageGenConfig({ ...valid, dailyCapByRole: [3, 5, null] }).ok).toBe(false)
  })
})

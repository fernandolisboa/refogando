import { describe, expect, it } from 'vitest'
import { atLeastVersion, isNewerVersion, parseModelId } from '@/domain/model-id'

describe('parseModelId', () => {
  it('lê família e versão, com menor e sufixo de data opcionais', () => {
    expect(parseModelId('claude-sonnet-5-5')).toEqual({ family: 'sonnet', major: 5, minor: 5 })
    expect(parseModelId('claude-sonnet-5')).toEqual({ family: 'sonnet', major: 5, minor: 0 })
    expect(parseModelId('claude-haiku-4-5-20251001')).toEqual({ family: 'haiku', major: 4, minor: 5 })
    expect(parseModelId('claude-opus-5-5-evil')).toBeNull()
    expect(parseModelId('gpt-4')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('compara maior e menor só dentro da mesma família', () => {
    expect(isNewerVersion('claude-sonnet-6', 'claude-sonnet-5-5')).toBe(true)
    expect(isNewerVersion('claude-sonnet-5-5', 'claude-sonnet-5')).toBe(true)
    expect(isNewerVersion('claude-haiku-4-5', 'claude-haiku-5-5')).toBe(false)
    expect(isNewerVersion('claude-sonnet-5-5', 'claude-sonnet-5-5')).toBe(false)
    expect(isNewerVersion('claude-opus-6', 'claude-sonnet-5')).toBe(false)
    expect(isNewerVersion('claude-opus-6', 'lixo')).toBe(false)
  })
})

describe('atLeastVersion', () => {
  it('versão mínima por família', () => {
    expect(atLeastVersion('claude-sonnet-5-5', 'sonnet', 5, 5)).toBe(true)
    expect(atLeastVersion('claude-sonnet-6', 'sonnet', 5, 5)).toBe(true)
    expect(atLeastVersion('claude-sonnet-5', 'sonnet', 5, 5)).toBe(false)
    expect(atLeastVersion('claude-opus-5-5', 'sonnet', 5, 5)).toBe(false)
  })
})

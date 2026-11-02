import { describe, expect, it } from 'vitest'
import {
  TRANSLATION_CAP_BY_ROLE,
  TRANSLATION_LEASE_MS,
  TRANSLATION_MAX_INPUT_CHARS,
  capForTranslation,
  decideTranslationFlight,
  isTranslationInputTooLarge,
  translationInputChars,
} from '@/domain/translation-flight'
import { TRANSLATION_MAX_TOKENS } from '@/domain/translation-prompt'

/** Guardas de custo da tradução sob demanda (#642, ADR-0056): decisões puras. */
describe('decideTranslationFlight', () => {
  const base = {
    translationExists: false,
    leaseActive: false,
    cooldownActive: false,
    storedFailKey: null,
    currentFailKey: 'fp:v2',
  }

  it('sem estado ⇒ go', () => {
    expect(decideTranslationFlight(base)).toBe('go')
  })

  it('tradução já gravada vence tudo (mesmo com lease ou cooldown)', () => {
    expect(
      decideTranslationFlight({ ...base, translationExists: true, leaseActive: true, cooldownActive: true }),
    ).toBe('exists')
  })

  it('lease valendo ⇒ in_progress', () => {
    expect(decideTranslationFlight({ ...base, leaseActive: true })).toBe('in_progress')
  })

  it('cooldown valendo com a MESMA chave ⇒ cooling_down', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'fp:v2' })).toBe('cooling_down')
  })

  it('cooldown com chave diferente (fonte editada ou prompt novo) ⇒ go', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'outra:v2' })).toBe('go')
    expect(decideTranslationFlight({ ...base, cooldownActive: true, storedFailKey: 'fp:v1' })).toBe('go')
  })

  it('cooldown vencido com a mesma chave ⇒ go', () => {
    expect(decideTranslationFlight({ ...base, cooldownActive: false, storedFailKey: 'fp:v2' })).toBe('go')
  })
})

describe('teto da entrada', () => {
  it('soma título, descrição, passos, notas, nomes de ingrediente e cozinha', () => {
    expect(
      translationInputChars({
        fields: { titulo: 'abc', descricao: 'de', passos: ['f', 'gh'], notas: 'i' },
        ingredientes: [{ nome: 'jk' }, { nome: 'l' }],
        cozinha: 'mn',
      }),
    ).toBe(3 + 2 + 3 + 1 + 3 + 2)
    expect(translationInputChars({ fields: { titulo: 'abc', descricao: null, passos: null } })).toBe(3)
  })

  it('o teto fica abaixo do que caberia no max_tokens da tradução', () => {
    expect(TRANSLATION_MAX_INPUT_CHARS).toBeLessThan(TRANSLATION_MAX_TOKENS * 4)
  })

  it('exatamente no teto passa; um caractere acima não', () => {
    const at = { fields: { titulo: 'x'.repeat(TRANSLATION_MAX_INPUT_CHARS) } }
    const over = { fields: { titulo: 'x'.repeat(TRANSLATION_MAX_INPUT_CHARS + 1) } }
    expect(isTranslationInputTooLarge(at)).toBe(false)
    expect(isTranslationInputTooLarge(over)).toBe(true)
  })
})

describe('capForTranslation', () => {
  it('teto por papel: usuario 30, curador 60, admin ∞', () => {
    expect(capForTranslation('usuario')).toBe(30)
    expect(capForTranslation('curador')).toBe(60)
    expect(capForTranslation('admin')).toBe(Infinity)
  })

  it('papel desconhecido/null ⇒ teto de usuario (fail-closed)', () => {
    expect(capForTranslation(null)).toBe(TRANSLATION_CAP_BY_ROLE.usuario)
    expect(capForTranslation('root' as never)).toBe(TRANSLATION_CAP_BY_ROLE.usuario)
  })
})

describe('lease', () => {
  it('dura mais que o maxDuration (60 s) da rota', () => {
    expect(TRANSLATION_LEASE_MS).toBeGreaterThan(60_000)
  })
})

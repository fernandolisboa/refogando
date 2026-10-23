import { describe, expect, it } from 'vitest'
import { MODERATION_CATEGORIES, isModerationCategory } from '@/domain/moderation-category'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'

/**
 * Lista fechada da categoria do motivo de uma retirada (#609). O guard é a borda das 4 rotas de retirada (o que
 * passar aqui vira o pgEnum `moderation_category`), e cada código tem rótulo para o dono e para o Curador nos dois
 * locales.
 */
describe('categoria do motivo da retirada (#609)', () => {
  it('isModerationCategory aceita só os códigos da lista, e `outro` é o último', () => {
    for (const c of MODERATION_CATEGORIES) expect(isModerationCategory(c)).toBe(true)
    expect(MODERATION_CATEGORIES.at(-1)).toBe('outro')
    for (const v of ['', 'Spam', 'plagio', ' spam', 'sexual_ou_violento', null, undefined, 3, {}]) {
      expect(isModerationCategory(v)).toBe(false)
    }
  })

  it('códigos snake_case ASCII, sem repetição', () => {
    for (const c of MODERATION_CATEGORIES) expect(c).toMatch(/^[a-z]+(_[a-z]+)*$/)
    expect(new Set(MODERATION_CATEGORIES).size).toBe(MODERATION_CATEGORIES.length)
  })

  it('rótulos do dono e do Curador nos dois locales, na ordem da lista', () => {
    for (const m of [ptBR, enUS]) {
      expect(Object.keys(m.categoriaModeracaoDono)).toEqual([...MODERATION_CATEGORIES])
      expect(Object.keys(m.categoriaModeracaoLabel)).toEqual([...MODERATION_CATEGORIES])
    }
  })
})

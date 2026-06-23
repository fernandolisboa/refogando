import { describe, it, expect } from 'vitest'
import {
  isUuidParam,
  decideRecipeDetailRoute,
  recipeDetailPath,
  eligibleForPublicRead,
} from '@/domain/recipe-detail-route'

/**
 * Lógica PURA da rota de detalhe por slug (#230, ADR-0020) — sem DB, sem React, sem `next/*`.
 * Cobre a DECISÃO de forma (uuid legado → 301 vs slug → render) e o predicado PURO do gate de
 * leitura pública (= gate de indexação default-open). O comportamento de DB de
 * `loadPublicRecipeBySlug` (casar (locale, slug), filtrar pelo gate) é coberto na integração (CI).
 *
 * Roda no projeto "ui" (jsdom, sem Postgres) por importar só domínio puro.
 */

describe('isUuidParam (param da rota tem forma de UUID?)', () => {
  it('reconhece um UUID v4 canônico', () => {
    expect(isUuidParam('11111111-2222-3333-4444-555555555555')).toBe(true)
    expect(isUuidParam('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true) // case-insensitive
  })

  it('um slug normal NÃO é UUID', () => {
    expect(isUuidParam('bolo-de-cenoura')).toBe(false)
    expect(isUuidParam('carrot-cake')).toBe(false)
    // slug numérico/hifenizado que NÃO casa o shape exato de uuid
    expect(isUuidParam('bolo-3-leites')).toBe(false)
    expect(isUuidParam('11111111-2222-3333-4444')).toBe(false) // curto demais
  })
})

describe('decideRecipeDetailRoute (uuid → redirect-uuid; senão → slug)', () => {
  it('UUID legado ⇒ redirect-uuid carregando o uuid (resolver slug + 301)', () => {
    expect(decideRecipeDetailRoute('11111111-2222-3333-4444-555555555555')).toEqual({
      kind: 'redirect-uuid',
      uuid: '11111111-2222-3333-4444-555555555555',
    })
  })

  it('slug ⇒ slug carregando o slug (renderizar leitura pública)', () => {
    expect(decideRecipeDetailRoute('bolo-de-cenoura')).toEqual({
      kind: 'slug',
      slug: 'bolo-de-cenoura',
    })
  })
})

describe('recipeDetailPath (URL canônica de detalhe)', () => {
  it('monta /{locale}/recipes/<slug>', () => {
    expect(recipeDetailPath('pt-BR', 'bolo-de-cenoura')).toBe('/pt-BR/recipes/bolo-de-cenoura')
    expect(recipeDetailPath('en-US', 'carrot-cake')).toBe('/en-US/recipes/carrot-cake')
  })
})

describe('eligibleForPublicRead (gate de leitura pública = gate de indexação)', () => {
  const base = { visibility: 'public', resultKind: 'success', moderationRemovedAt: null as Date | null }

  it('pública + não-playful + não-removida ⇒ legível/indexável', () => {
    expect(eligibleForPublicRead(base)).toBe(true)
  })

  it('privada ⇒ NÃO legível publicamente (cai no caminho do dono)', () => {
    expect(eligibleForPublicRead({ ...base, visibility: 'private' })).toBe(false)
  })

  it('playful ⇒ NÃO legível publicamente (mesmo que marcada public por bug)', () => {
    expect(eligibleForPublicRead({ ...base, resultKind: 'playful' })).toBe(false)
  })

  it('removida pela moderação ⇒ NÃO legível publicamente', () => {
    expect(eligibleForPublicRead({ ...base, moderationRemovedAt: new Date() })).toBe(false)
  })
})

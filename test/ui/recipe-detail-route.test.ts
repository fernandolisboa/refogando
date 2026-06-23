import { describe, it, expect } from 'vitest'
import {
  isUuidParam,
  decideRecipeDetailRoute,
  recipeDetailPath,
  eligibleForPublicRead,
  LEGACY_UUID_REDIRECT_STATUS,
} from '@/domain/recipe-detail-route'

/**
 * Lógica PURA da rota de detalhe por slug (#230, ADR-0020) — sem DB, sem React, sem `next/*`.
 * Cobre a DECISÃO de forma (uuid legado → resolver slug + 308 no server component vs slug → render)
 * e o predicado PURO do gate de leitura pública (= gate de indexação default-open). O comportamento
 * de DB de `loadPublicRecipeBySlug`/`resolvePublicSlugForLocale` (casar (locale, slug), filtrar
 * pelo gate) é coberto na integração (CI).
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
  it('UUID legado ⇒ redirect-uuid carregando o uuid (o server component resolve o slug e 308-a)', () => {
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

describe('LEGACY_UUID_REDIRECT_STATUS', () => {
  it('é 308 (permanente) — permanentRedirect do server component; canonicalização UUID→slug (decisão 4)', () => {
    // O ADR-0020 escreve "301", mas o redirect PERMANENTE de Server Component que o Next 16 emite
    // é 308 — equivalente p/ SEO (permanente, cacheável, consolida link equity), e mantém o gate
    // "no server component" (sem DB no proxy). O contraste do ADR é permanente (308/301) vs o 302
    // da detecção de locale; ambos honram esse intento.
    expect(LEGACY_UUID_REDIRECT_STATUS).toBe(308)
  })
})

describe('eligibleForPublicRead (gate de leitura pública = gate de indexação)', () => {
  const base = {
    ownerId: 'u1' as string | null,
    visibility: 'public',
    resultKind: 'success',
    moderationRemovedAt: null as Date | null,
  }

  it('comunidade (dono + pública) + não-playful + não-removida ⇒ legível/indexável', () => {
    expect(eligibleForPublicRead(base)).toBe(true)
  })

  it('Receita com dono + privada ⇒ NÃO legível publicamente (cai no caminho do dono)', () => {
    expect(eligibleForPublicRead({ ...base, visibility: 'private' })).toBe(false)
  })

  it('Catálogo (ownerId NULL) + visibility=private ⇒ LEGÍVEL/indexável (eixo de comunidade)', () => {
    // Carga de propósito: o Catálogo nasce visibility=private + ownerId NULL (createCatalogRecipe);
    // o eixo owner-NULL abre a leitura (igual ao GET por uuid via isCommunityVisible), senão o
    // Catálogo inteiro cairia do índice/da leitura por slug (contra a exceção editorial do ADR).
    expect(eligibleForPublicRead({ ...base, ownerId: null, visibility: 'private' })).toBe(true)
  })

  it('Catálogo (ownerId NULL) playful ⇒ NÃO legível (playful sempre fora, mesmo no Catálogo)', () => {
    expect(
      eligibleForPublicRead({ ...base, ownerId: null, visibility: 'private', resultKind: 'playful' }),
    ).toBe(false)
  })

  it('Catálogo (ownerId NULL) removido pela moderação ⇒ NÃO legível', () => {
    expect(
      eligibleForPublicRead({ ...base, ownerId: null, moderationRemovedAt: new Date() }),
    ).toBe(false)
  })

  it('playful ⇒ NÃO legível publicamente (mesmo que marcada public por bug)', () => {
    expect(eligibleForPublicRead({ ...base, resultKind: 'playful' })).toBe(false)
  })

  it('removida pela moderação ⇒ NÃO legível publicamente', () => {
    expect(eligibleForPublicRead({ ...base, moderationRemovedAt: new Date() })).toBe(false)
  })
})

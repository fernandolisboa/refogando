import { describe, expect, it } from 'vitest'
import { resolveRecipeListItem, type RecipeListRow } from '@/domain/recipe-list-read'
import { projectProfileRecipe, type ProfileRecipeRow } from '@/domain/recipe-profile-read'
import type { TranslationRow } from '@/domain/recipe-read'

/**
 * Slug do locale corrente nos DTOs do dono (#231, ADR-0020): a "Minha criação" e o item do perfil
 * público carregam o slug do locale pedido (resolvido na borda) pro card linkar o canônico
 * `/{locale}/recipes/<slug>`. Ausente ⇒ a chave some ("ausente ≠ vazio") e o card cai no fallback
 * por UUID. Estes são os BUILDERS PUROS (sem DB) — o loader projeta o slug e o builder o copia.
 */

const ptTranslation: TranslationRow = {
  locale: 'pt-BR',
  titulo: 'Bolo de fubá',
  descricao: null,
  passos: null,
  notas: null,
  provenance: 'escrita_por_pessoa',
  stale: false,
}

function listRow(over: Partial<RecipeListRow> = {}): RecipeListRow {
  return {
    id: 'r-1',
    origin: 'ai_structured',
    visibility: 'private',
    resultKind: 'success',
    lineageKind: null,
    originalLocale: 'pt-BR',
    updatedAt: '2026-06-23T00:00:00.000Z',
    moderationRemovida: false,
    translations: [ptTranslation],
    ...over,
  }
}

describe('resolveRecipeListItem — slug do locale corrente (#231)', () => {
  it('slug presente ⇒ copiado pro RecipeListItem', () => {
    const item = resolveRecipeListItem(listRow({ slug: 'bolo-de-fuba' }), 'pt-BR', 'Sem título')
    expect(item.slug).toBe('bolo-de-fuba')
  })

  it('slug ausente ⇒ chave omitida (fallback por UUID)', () => {
    const item = resolveRecipeListItem(listRow(), 'pt-BR', 'Sem título')
    expect(item.slug).toBeUndefined()
    expect('slug' in item).toBe(false)
  })
})

function profileRow(over: Partial<ProfileRecipeRow> = {}): ProfileRecipeRow {
  return {
    id: 'r-1',
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    translations: [ptTranslation],
    ...over,
  }
}

describe('projectProfileRecipe — slug do locale corrente (#231)', () => {
  it('slugByLocale com o locale pedido ⇒ slug projetado', () => {
    const item = projectProfileRecipe(
      profileRow({ slugByLocale: { 'pt-BR': 'bolo-de-fuba', 'en-US': 'cornmeal-cake' } }),
      'pt-BR',
    )
    expect(item).not.toBeNull()
    expect(item!.slug).toBe('bolo-de-fuba')
  })

  it('locale pedido sem slug no mapa ⇒ chave omitida (fallback por UUID)', () => {
    const item = projectProfileRecipe(
      profileRow({ slugByLocale: { 'en-US': 'cornmeal-cake' } }),
      'pt-BR',
    )
    expect(item).not.toBeNull()
    expect(item!.slug).toBeUndefined()
    expect('slug' in item!).toBe(false)
  })

  it('sem slugByLocale ⇒ chave omitida', () => {
    const item = projectProfileRecipe(profileRow(), 'pt-BR')
    expect(item).not.toBeNull()
    expect(item!.slug).toBeUndefined()
  })
})

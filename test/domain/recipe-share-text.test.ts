import { describe, it, expect } from 'vitest'
import { buildRecipeShareText } from '@/domain/recipe-share-text'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'

/**
 * `buildRecipeShareText` (#453) — formato "grupo de WhatsApp": título → ingredientes →
 * modo de preparo → link, cabeçalhos reusando `m.detalhe.ingredientes`/`m.detalhe.passos`.
 */
describe('buildRecipeShareText — texto de compartilhamento (#453)', () => {
  it('monta título + ingredientes + passos + link (pt-BR)', () => {
    const text = buildRecipeShareText(
      {
        name: 'Chili do Texas',
        ingredientLines: ['2 dentes de alho', '200 g de farinha'],
        steps: ['Refogue o alho', 'Adicione a farinha'],
        url: 'https://refogando.com/pt-BR/recipes/chili-do-texas',
      },
      ptBR,
    )
    expect(text).toBe(
      [
        'Chili do Texas',
        '',
        'Ingredientes:',
        '- 2 dentes de alho',
        '- 200 g de farinha',
        '',
        'Modo de preparo:',
        '1. Refogue o alho',
        '2. Adicione a farinha',
        '',
        'https://refogando.com/pt-BR/recipes/chili-do-texas',
      ].join('\n'),
    )
  })

  it('en-US: cabeçalhos localizados (Ingredients/Steps)', () => {
    const text = buildRecipeShareText(
      {
        name: 'Texas Chili',
        ingredientLines: ['3 cloves of garlic'],
        steps: ['Sauté the garlic'],
        url: 'https://refogando.com/en-US/recipes/texas-chili',
      },
      enUS,
    )
    expect(text).toContain(`${enUS.detalhe.ingredientes}:`)
    expect(text).toContain(`${enUS.detalhe.passos}:`)
    expect(text.endsWith('https://refogando.com/en-US/recipes/texas-chili')).toBe(true)
  })

  it('sem ingredientes ⇒ seção "Ingredientes" OMITIDA inteira', () => {
    const text = buildRecipeShareText(
      { name: 'Água com gás', ingredientLines: [], steps: ['Sirva gelado'], url: 'https://x/y' },
      ptBR,
    )
    expect(text).not.toContain(`${ptBR.detalhe.ingredientes}:`)
    expect(text).toContain(`${ptBR.detalhe.passos}:`)
  })

  it('sem passos ⇒ seção "Modo de preparo" OMITIDA inteira', () => {
    const text = buildRecipeShareText(
      { name: 'Suco', ingredientLines: ['1 laranja'], steps: [], url: 'https://x/y' },
      ptBR,
    )
    expect(text).not.toContain(`${ptBR.detalhe.passos}:`)
    expect(text).toContain(`${ptBR.detalhe.ingredientes}:`)
  })

  it('sem ingredientes E sem passos ⇒ só título + link', () => {
    const text = buildRecipeShareText(
      { name: 'Receita vazia', ingredientLines: [], steps: [], url: 'https://x/y' },
      ptBR,
    )
    expect(text).toBe('Receita vazia\n\nhttps://x/y')
  })

  it('o LINK aparece só UMA vez, ao final (nunca duplicado)', () => {
    const text = buildRecipeShareText(
      {
        name: 'Receita',
        ingredientLines: ['a'],
        steps: ['b'],
        url: 'https://refogando.com/pt-BR/recipes/receita',
      },
      ptBR,
    )
    const matches = text.match(/https:\/\/refogando\.com\/pt-BR\/recipes\/receita/g)
    expect(matches).toHaveLength(1)
    expect(text.trim().endsWith('https://refogando.com/pt-BR/recipes/receita')).toBe(true)
  })
})

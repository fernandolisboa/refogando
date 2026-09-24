import { describe, it, expect } from 'vitest'
import { mergeIngredientNameEdits } from '@/domain/ingredient-name-edit'

/**
 * `mergeIngredientNameEdits` — edição do nome de ingrediente traduzido pelo Curador (#498,
 * ADR-0031 companheiro (iii)). Puro, sem I/O: mescla edições `{ordem, nome, rawTextAtual}`
 * no `ingredientes jsonb` existente, PRESERVANDO entradas não-editadas.
 */
describe('mergeIngredientNameEdits', () => {
  it('sobrescreve o nome de uma entrada existente + grava nomeOrigem = raw_text ATUAL', () => {
    const existing = [
      { ordem: 0, nome: 'garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' },
    ]
    const result = mergeIngredientNameEdits(existing, [
      { ordem: 0, nome: 'fresh garlic', rawTextAtual: 'alho' },
    ])
    expect(result).toEqual([
      { ordem: 0, nome: 'fresh garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' },
    ])
  })

  it('preserva entradas NÃO editadas intocadas', () => {
    const existing = [
      { ordem: 0, nome: 'garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'black beans', nomeOrigem: 'feijão-preto' },
    ]
    const result = mergeIngredientNameEdits(existing, [
      { ordem: 1, nome: 'black bean', rawTextAtual: 'feijão-preto' },
    ])
    expect(result.find((i) => i.ordem === 0)).toEqual({ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' })
  })

  it('LOAD-BEARING: grava nomeOrigem = raw_text ATUAL, mesmo quando a entrada antiga já divergia (rename prévio) — garante que o nome editado seja exibido', () => {
    // Entrada antiga já estava "quebrada": nomeOrigem='alho' mas o ingrediente foi renomeado
    // para 'alho roxo' (raw_text atual) sem re-tradução — o display cairia no raw_text. Editar
    // o nome AGORA deve religar a resolução ao raw_text atual, não repetir o nomeOrigem velho.
    const existing = [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }]
    const result = mergeIngredientNameEdits(existing, [
      { ordem: 0, nome: 'purple garlic', rawTextAtual: 'alho roxo' },
    ])
    expect(result).toEqual([{ ordem: 0, nome: 'purple garlic', nomeOrigem: 'alho roxo' }])
  })

  it('cria uma NOVA entrada para um ordem editado ausente do jsonb existente', () => {
    const existing = [{ ordem: 0, nome: 'garlic', nomeOrigem: 'alho' }]
    const result = mergeIngredientNameEdits(existing, [
      { ordem: 1, nome: 'salt', rawTextAtual: 'sal' },
    ])
    expect(result).toEqual([
      { ordem: 0, nome: 'garlic', nomeOrigem: 'alho' },
      { ordem: 1, nome: 'salt', nomeOrigem: 'sal' },
    ])
  })

  it('existing NULL (sem ingrediente nomeado ainda) ⇒ parte de array vazio', () => {
    const result = mergeIngredientNameEdits(null, [{ ordem: 0, nome: 'salt', rawTextAtual: 'sal' }])
    expect(result).toEqual([{ ordem: 0, nome: 'salt', nomeOrigem: 'sal' }])
  })

  it('sem edições ⇒ devolve o existing inalterado (só reordenado por ordem)', () => {
    const existing = [
      { ordem: 1, nome: 'b', nomeOrigem: 'B' },
      { ordem: 0, nome: 'a', nomeOrigem: 'A' },
    ]
    const result = mergeIngredientNameEdits(existing, [])
    expect(result).toEqual([
      { ordem: 0, nome: 'a', nomeOrigem: 'A' },
      { ordem: 1, nome: 'b', nomeOrigem: 'B' },
    ])
  })
})

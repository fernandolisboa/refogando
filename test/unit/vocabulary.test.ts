import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS,
  COZINHAS,
  DIFICULDADE,
  PORCOES,
  RESTRICOES,
  isCategoria,
  isCozinha,
  isDificuldadeValida,
  isPorcoesValidas,
  isRestricao,
  vocabularioCulinario,
} from '@/domain/vocabulary'

describe('Vocabulário culinário — kernel (fonte única)', () => {
  it('pertencimento de Cozinha', () => {
    expect(isCozinha('italiana')).toBe(true)
    expect(isCozinha('marciana')).toBe(false)
  })

  it('pertencimento de Restrição alimentar', () => {
    expect(isRestricao('sem_gluten')).toBe(true)
    expect(isRestricao('paleo_extremo')).toBe(false)
  })

  it('Dificuldade é faixa numérica validada no app (ADR-0009)', () => {
    expect(isDificuldadeValida(DIFICULDADE.min)).toBe(true)
    expect(isDificuldadeValida(DIFICULDADE.max)).toBe(true)
    expect(isDificuldadeValida(0)).toBe(false)
    expect(isDificuldadeValida(DIFICULDADE.max + 1)).toBe(false)
    expect(isDificuldadeValida(2.5)).toBe(false)
  })

  it('Porções é faixa numérica validada no app (ADR-0009)', () => {
    expect(isPorcoesValidas(PORCOES.min)).toBe(true)
    expect(isPorcoesValidas(PORCOES.max)).toBe(true)
    expect(isPorcoesValidas(0)).toBe(false)
    expect(isPorcoesValidas(PORCOES.max + 1)).toBe(false)
  })

  it('o kernel bidirecional expõe só cozinha/restrição/dificuldade/porções', () => {
    expect(Object.keys(vocabularioCulinario).sort()).toEqual([
      'cozinhas',
      'dificuldade',
      'porcoes',
      'restricoes',
    ])
  })

  it('o kernel é a fonte única: referencia os mesmos arrays canônicos', () => {
    expect(vocabularioCulinario.cozinhas).toBe(COZINHAS)
    expect(vocabularioCulinario.restricoes).toBe(RESTRICOES)
    expect(COZINHAS.length).toBeGreaterThan(0)
    expect(RESTRICOES.length).toBeGreaterThan(0)
  })

  it('Categoria é vocabulário SEPARADO, fora do kernel bidirecional', () => {
    expect(isCategoria('sobremesa')).toBe(true)
    expect(isCategoria('italiana')).toBe(false) // cozinha não é categoria
    // Categoria não vaza para dentro do kernel de Briefing/Busca.
    expect(Object.values(vocabularioCulinario)).not.toContain(CATEGORIAS)
  })
})

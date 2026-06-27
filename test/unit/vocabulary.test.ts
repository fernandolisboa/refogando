import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS,
  DIFICULDADE,
  PORCOES,
  RESTRICOES,
  UNIDADES,
  isActiveCozinha,
  isCategoria,
  isDificuldadeValida,
  isPorcoesValidas,
  isRestricao,
  isUnidade,
  vocabularioCulinario,
} from '@/domain/vocabulary'

describe('Vocabulário culinário — kernel (fonte única)', () => {
  it('isActiveCozinha (#316/#318): pertencimento ao conjunto ATIVO injetado (cozinha é data-driven)', () => {
    // Cozinha saiu do enum (#318) — a ÚNICA regra é "está no conjunto ativo injetado?".
    // Presente no conjunto → aceito; ausente → recusado; conjunto vazio → tudo recusado.
    expect(isActiveCozinha('italiana', new Set(['italiana']))).toBe(true)
    expect(isActiveCozinha('italiana', new Set(['japonesa']))).toBe(false)
    expect(isActiveCozinha('italiana', new Set<string>())).toBe(false)
    // 'americana' (data-driven, nunca esteve num enum) é aceita só quando está no conjunto.
    expect(isActiveCozinha('americana', new Set(['italiana', 'americana']))).toBe(true)
    expect(isActiveCozinha('americana', new Set(['italiana', 'japonesa']))).toBe(false)
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

  it('o kernel bidirecional expõe só restrição/dificuldade/porções (cozinha saiu — data-driven #318)', () => {
    expect(Object.keys(vocabularioCulinario).sort()).toEqual([
      'dificuldade',
      'porcoes',
      'restricoes',
    ])
  })

  it('o kernel é a fonte única: referencia os mesmos arrays canônicos', () => {
    expect(vocabularioCulinario.restricoes).toBe(RESTRICOES)
    expect(RESTRICOES.length).toBeGreaterThan(0)
  })

  it('Categoria é vocabulário SEPARADO, fora do kernel bidirecional', () => {
    expect(isCategoria('sobremesa')).toBe(true)
    expect(isCategoria('italiana')).toBe(false) // cozinha não é categoria
    // Categoria não vaza para dentro do kernel de Briefing/Busca.
    expect(Object.values(vocabularioCulinario)).not.toContain(CATEGORIAS)
  })

  it('pertencimento de Unidade (enum-do-kernel, ADR-0012)', () => {
    expect(isUnidade('g')).toBe(true)
    expect(isUnidade('colher_de_sopa')).toBe(true)
    expect(isUnidade('a_gosto')).toBe(true)
    expect(isUnidade('q_b')).toBe(true)
    expect(isUnidade('quilograma')).toBe(false) // não é a forma canônica (é 'kg')
    expect(isUnidade('')).toBe(false)
  })

  it('UNIDADES contém as unidades canônicas esperadas', () => {
    for (const u of [
      'g',
      'kg',
      'ml',
      'l',
      'colher_de_sopa',
      'colher_de_cha',
      'xicara',
      'unidade',
      'dente',
      'fatia',
      'pitada',
      'a_gosto',
      'q_b',
    ]) {
      expect((UNIDADES as readonly string[]).includes(u)).toBe(true)
    }
    expect(UNIDADES).toHaveLength(13)
  })
})

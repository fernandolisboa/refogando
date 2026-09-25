import { describe, expect, it } from 'vitest'
import {
  normalizeCategoria,
  normalizeCozinha,
  normalizeQuantidade,
  normalizeRestricao,
  normalizeUnidade,
} from '@/domain/vocabulary-normalize'

describe('normalizeQuantidade', () => {
  it.each([
    ['2', '2'],
    ['2.500', '2.500'],
    ['2,5', '2.5'],
    [' 3 ', '3'],
    ['1/2', '0.5'],
    ['1 1/2', '1.5'],
    ['½', '0.5'],
    ['1½', '1.5'],
    ['1 ⅓', '1.333'],
    ['2-3', '2'],
    ['2 a 3', '2'],
    ['200g', '200'],
    ['2 xícaras', '2'],
    ['cerca de 2', '2'],
    ['0.0625', '0.063'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeQuantidade(raw)).toBe(esperado)
  })

  it.each(['a gosto', 'q.b.', '', '   ', '0', '1/0', '12345678', '0.0001'])('%j → null', (raw) => {
    // '0' é aceito como veio (já é numeric válido); os demais não têm número utilizável.
    expect(normalizeQuantidade(raw)).toBe(raw === '0' ? '0' : null)
  })
})

describe('normalizeUnidade', () => {
  it.each([
    ['g', 'g'],
    ['Gramas', 'g'],
    ['colher de sopa', 'colher_de_sopa'],
    ['Colheres de Chá', 'colher_de_cha'],
    ['colher-de-sopa', 'colher_de_sopa'],
    ['tsp', 'colher_de_cha'],
    ['cups', 'xicara'],
    ['A gosto', 'a_gosto'],
    ['to taste', 'a_gosto'],
    ['q.b.', 'q_b'],
    ['QB', 'q_b'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeUnidade(raw)).toBe(esperado)
  })

  it.each(['maço', 'lata', 'oz', ''])('%j → null', (raw) => {
    expect(normalizeUnidade(raw)).toBeNull()
  })
})

describe('normalizeCategoria', () => {
  it.each([
    ['prato_principal', 'prato_principal'],
    ['Prato Principal', 'prato_principal'],
    ['Café da manhã', 'cafe_da_manha'],
    ['Dessert', 'sobremesa'],
    ['side dish', 'acompanhamento'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeCategoria(raw)).toBe(esperado)
  })

  it('não reconhecida → null', () => {
    expect(normalizeCategoria('Italiana')).toBeNull()
  })
})

describe('normalizeRestricao', () => {
  it.each([
    ['sem_gluten', 'sem_gluten'],
    ['Sem glúten', 'sem_gluten'],
    ['gluten-free', 'sem_gluten'],
    ['Vegan', 'vegano'],
    ['dairy free', 'sem_lactose'],
    ['Low carb', 'low_carb'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeRestricao(raw)).toBe(esperado)
  })

  it('não adivinha: termo que não afirma a mesma restrição → null', () => {
    for (const raw of ['paleo', 'shellfish free', 'kosher']) expect(normalizeRestricao(raw)).toBeNull()
  })
})

describe('normalizeCozinha', () => {
  const ativas = new Set(['italiana', 'arabe', 'cozinha-nordestina'])

  it.each([
    ['italiana', 'italiana'],
    ['Italiana', 'italiana'],
    ['Árabe', 'arabe'],
    ['Italian', 'italiana'],
    ['Cozinha Nordestina', 'cozinha-nordestina'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeCozinha(raw, ativas)).toBe(esperado)
  })

  it('fora do conjunto ativo → null', () => {
    expect(normalizeCozinha('Japonesa', ativas)).toBeNull()
    expect(normalizeCozinha('marciana', ativas)).toBeNull()
  })

  it('conjunto vazio ⇒ sem constraint (devolve como veio, regra do schema estático)', () => {
    expect(normalizeCozinha('Qualquer', new Set())).toBe('Qualquer')
  })
})

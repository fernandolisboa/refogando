import { describe, expect, it } from 'vitest'
import {
  normalizeCategoria,
  normalizeCozinha,
  normalizeRestricao,
  normalizeUnidade,
  parseMedida,
} from '@/domain/vocabulary-normalize'

describe('parseMedida', () => {
  it.each([
    ['2', '2', null],
    ['2.500', '2.500', null],
    ['2,5', '2.5', null],
    [' 3 ', '3', null],
    ['.5', '0.5', null],
    ['1/2', '0.5', null],
    ['1 1/2', '1.5', null],
    ['1-1/2', '1.5', null],
    ['½', '0.5', null],
    ['1½', '1.5', null],
    ['1 ⅓', '1.333', null],
    ['200g', '200', 'g'],
    ['2 xícaras', '2', 'xicara'],
    ['2 xícaras (chá)', '2', 'xicara'],
    ['0.0625', '0.063', null],
    ['a gosto', null, 'a_gosto'],
    ['q.b.', null, 'q_b'],
  ])('%j → quantidade %j, unidade %j, nada perdido', (raw, quantidade, unidade) => {
    expect(parseMedida(raw)).toEqual({ quantidade, unidade, resto: '' })
  })

  it.each([
    ['2-3', '2', null, '-3'],
    ['2 a 3', '2', null, 'a 3'],
    ['1-2 xícaras', '1', 'xicara', '-2 xícaras'],
    ['3 maços', '3', null, 'maços'],
    ['cerca de 2', '2', null, 'cerca de'],
  ])('faixa/qualificador: %j → %j %j, e o que se perdeu (%j) vai para o log', (raw, quantidade, unidade, resto) => {
    expect(parseMedida(raw)).toEqual({ quantidade, unidade, resto })
  })

  it.each([
    '1,000',
    '2,500',
    '1.000,5',
    '1 000',
    '2 x 200g',
    '2 e 1/2',
    '1e5',
    '-2',
    '–2',
    '-1/2',
    '0',
    '12345678',
    'um maço',
    '1/0',
  ])(
    'nunca adivinha: %j → quantidade null (e o cru vai para o log)',
    (raw) => {
      expect(parseMedida(raw)).toEqual({ quantidade: null, unidade: null, resto: raw })
    },
  )

  it('vazio → tudo null, nada a registrar', () => {
    expect(parseMedida('  ')).toEqual({ quantidade: null, unidade: null, resto: '' })
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

  it.each(['maço', 'lata', 'oz', '', 'constructor', '__proto__', 'toString'])('%j → null', (raw) => {
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

  it.each(['Sobremesas', 'Pratos principais', 'Starter'])('plural/rótulo %j casa', (raw) => {
    expect(normalizeCategoria(raw)).not.toBeNull()
  })

  it.each(['Italiana', 'constructor', 'Constructor'])('não reconhecida %j → null', (raw) => {
    expect(normalizeCategoria(raw)).toBeNull()
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
    ['Vegana', 'vegano'],
    ['Vegetariana', 'vegetariano'],
    // rótulo en-US do próprio app para sem_frutos_do_mar
    ['shellfish-free', 'sem_frutos_do_mar'],
  ])('%j → %j', (raw, esperado) => {
    expect(normalizeRestricao(raw)).toBe(esperado)
  })

  it('não adivinha: termo que não afirma a mesma restrição → null', () => {
    for (const raw of ['paleo', 'kosher', 'constructor']) expect(normalizeRestricao(raw)).toBeNull()
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

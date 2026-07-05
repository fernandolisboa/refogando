import { describe, it, expect } from 'vitest'
import { formatIngredientLine, scaleQuantidade, scaleIngredient } from '@/domain/ingredient-line'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { IngredientView } from '@/domain/recipe-read'

/**
 * `formatIngredientLine` — fonte ÚNICA da linha de ingrediente exibida (detalhe + JSON-LD).
 *
 * CONTRATO (ADR-0012 Adendo 2, 2026-06-30): a medida estruturada (`quantidade`/`unidade`) é a fonte
 * ÚNICA da medida; `rawText` é o NOME do ingrediente SEM a medida ("arroz arbóreo"). A exibição
 * COMPÕE PROSA NATURAL com plural correto (revoga o "zero gramática"/em-dash do Adendo anterior):
 *   - não-contável: "{qtd} {unidade flexionada} {conector} {nome}" — "3 dentes de alho",
 *     "200 g de farinha", "2 colheres de sopa de azeite" (en: "3 cloves of garlic"); a UNIDADE
 *     flexiona pela quantidade, o conector é LOCALIZADO ("de"/"of"), o NOME nunca é flexionado;
 *   - contável (`unidade`): larga a palavra "unidade" → "{qtd} {nome}" ("2 cebolas");
 *   - `a_gosto`/`q_b`: SUFIXO sem traço → "{nome} a gosto" / "{nome} q.b.";
 *   - sem medida (qty null + unidade null): só "{nome}".
 * Números/frações por locale: "2.500"→"2½", "0.5"→"½" (`formatQuantityDisplay`).
 * O FALLBACK defensivo (nome ausente/vazio) exibe só a medida estruturada flexionada.
 */
const m = ptBR
function ing(over: Partial<IngredientView>): IngredientView {
  return { ordem: 1, quantidade: null, unidade: null, rawText: null, ...over } as IngredientView
}

describe('formatIngredientLine — prosa natural com plural (ADR-0012 Adendo 2)', () => {
  // ── não-contável: "{qtd} {unidade flexionada} {conector} {nome}" ───────────────────
  it('não-contável (g): "200 g de farinha" (g invariável, conector "de")', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'farinha', quantidade: '200', unidade: 'g' }), m, 'pt-BR'),
    ).toBe('200 g de farinha')
  })

  it('não-contável plural (dente): "3 dentes de alho" — flexiona a unidade', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'alho', quantidade: '3', unidade: 'dente' }), m, 'pt-BR'),
    ).toBe('3 dentes de alho')
  })

  it('não-contável singular qty=1 (dente): "1 dente de alho"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'alho', quantidade: '1', unidade: 'dente' }), m, 'pt-BR'),
    ).toBe('1 dente de alho')
  })

  it('não-contável composta (colher_de_sopa): plural de cabeça + fração glifo: "2½ colheres de sopa de azeite"', () => {
    expect(
      formatIngredientLine(
        ing({ rawText: 'azeite', quantidade: '2.500', unidade: 'colher_de_sopa' }),
        m,
        'pt-BR',
      ),
    ).toBe('2½ colheres de sopa de azeite')
  })

  it('não-contável plural inteiro (colher_de_sopa): "2 colheres de sopa de azeite"', () => {
    expect(
      formatIngredientLine(
        ing({ rawText: 'azeite', quantidade: '2', unidade: 'colher_de_sopa' }),
        m,
        'pt-BR',
      ),
    ).toBe('2 colheres de sopa de azeite')
  })

  it('não-contável fração < 1 ⇒ SINGULAR: "½ xícara de leite"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'leite', quantidade: '0.5', unidade: 'xicara' }), m, 'pt-BR'),
    ).toBe('½ xícara de leite')
  })

  it('não-contável plural (xicara): "2 xícaras de feijão"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'feijão', quantidade: '2.000', unidade: 'xicara' }), m, 'pt-BR'),
    ).toBe('2 xícaras de feijão')
  })

  // ── en-US: plural + conector "of" ──────────────────────────────────────────────────
  it('en-US plural (dente→cloves) + conector "of": "3 cloves of garlic"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'garlic', quantidade: '3', unidade: 'dente' }), enUS, 'en-US'),
    ).toBe('3 cloves of garlic')
  })

  it('en-US (g invariável) + conector "of": "200 g of flour"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'flour', quantidade: '200', unidade: 'g' }), enUS, 'en-US'),
    ).toBe('200 g of flour')
  })

  it('en-US singular qty=1 (cup): "1 cup of rice"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'rice', quantidade: '1', unidade: 'xicara' }), enUS, 'en-US'),
    ).toBe('1 cup of rice')
  })

  // ── contável: larga "unidade", NOME verbatim, sem conector ──────────────────────────
  it('contável (`unidade`): "2 cebolas" — sem unidade, sem conector, nome verbatim', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cebolas', quantidade: '2', unidade: 'unidade' }), m, 'pt-BR'),
    ).toBe('2 cebolas')
  })

  it('contável (`unidade`) com fração glifo: "1½ abobrinhas"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'abobrinhas', quantidade: '1.500', unidade: 'unidade' }), m, 'pt-BR'),
    ).toBe('1½ abobrinhas')
  })

  it('contável (`unidade`) SEM quantidade ⇒ só o nome', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cebola picada', quantidade: null, unidade: 'unidade' }), m, 'pt-BR'),
    ).toBe('cebola picada')
  })

  // ── a_gosto / q_b: sufixo SEM traço ─────────────────────────────────────────────────
  it('a_gosto: SUFIXO sem traço "sal a gosto"', () => {
    expect(formatIngredientLine(ing({ rawText: 'sal', unidade: 'a_gosto' }), m, 'pt-BR')).toBe(
      `sal ${m.unidadeLabel.a_gosto}`,
    )
  })

  it('q_b: SUFIXO sem traço "fermento q.b."', () => {
    expect(formatIngredientLine(ing({ rawText: 'fermento', unidade: 'q_b' }), m, 'pt-BR')).toBe(
      `fermento ${m.unidadeLabel.q_b}`,
    )
  })

  it('a_gosto com quantidade (defensivo): a qty é IGNORADA no sufixo', () => {
    expect(formatIngredientLine(ing({ rawText: 'pimenta', quantidade: '1', unidade: 'a_gosto' }), m, 'pt-BR')).toBe(
      `pimenta ${m.unidadeLabel.a_gosto}`,
    )
  })

  // ── sem unidade / sem medida ────────────────────────────────────────────────────────
  it('quantidade SEM unidade (ex.: importação "3 cenouras médias") ⇒ "{qtd} {nome}"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cenouras médias', quantidade: '3', unidade: null }), m, 'pt-BR'),
    ).toBe('3 cenouras médias')
  })

  it('sem medida (qty null + unidade null) ⇒ só o nome', () => {
    expect(formatIngredientLine(ing({ rawText: 'folhas de louro' }), m, 'pt-BR')).toBe('folhas de louro')
  })

  it('unidade não-contável SEM quantidade ⇒ larga o rótulo órfão, só o nome', () => {
    expect(formatIngredientLine(ing({ rawText: 'arroz', quantidade: null, unidade: 'g' }), m, 'pt-BR')).toBe('arroz')
  })

  // ── invariância g/kg/ml/l + sem vazamento de token cru + sem duplicação ─────────────
  it('g/kg/ml/l são invariáveis no plural (não inventam "gs")', () => {
    expect(formatIngredientLine(ing({ rawText: 'farinha', quantidade: '200', unidade: 'g' }), m, 'pt-BR')).toBe('200 g de farinha')
    expect(formatIngredientLine(ing({ rawText: 'leite', quantidade: '300', unidade: 'ml' }), m, 'pt-BR')).toBe('300 ml de leite')
    expect(formatIngredientLine(ing({ rawText: 'arroz', quantidade: '2', unidade: 'kg' }), m, 'pt-BR')).toBe('2 kg de arroz')
  })

  it('o token cru do enum NUNCA aparece (unidade é sempre LOCALIZADA)', () => {
    const line = formatIngredientLine(ing({ rawText: 'azeite', quantidade: '2', unidade: 'colher_de_sopa' }), m, 'pt-BR')
    expect(line).not.toMatch(/colher_de_sopa/)
  })

  it('NÃO duplica a medida: nome já SEM medida ⇒ a medida aparece UMA vez', () => {
    const line = formatIngredientLine(ing({ rawText: 'arroz arbóreo', quantidade: '320', unidade: 'g' }), m, 'pt-BR')
    expect(line).toBe('320 g de arroz arbóreo')
    expect(line.match(/320 g/g)).toHaveLength(1)
  })

  // ── FALLBACK defensivo: nome ausente/vazio (não ocorre em prod pós-migração) ─────────
  it('FALLBACK: nome ausente ⇒ medida estruturada (fração glifo + unidade flexionada)', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: '2.500', unidade: 'colher_de_sopa' }), m, 'pt-BR')).toBe(
      `2½ ${m.unidadeLabelPlural.colher_de_sopa}`,
    )
  })

  it('FALLBACK: nome só-espaços tratado como ausente ⇒ cai na medida flexionada', () => {
    expect(formatIngredientLine(ing({ rawText: '   ', quantidade: '3.000', unidade: 'unidade' }), m, 'pt-BR')).toBe(
      `3 ${m.unidadeLabelPlural.unidade}`,
    )
  })

  it('FALLBACK: a_gosto sem nome ⇒ só o rótulo ("a gosto")', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: null, unidade: 'a_gosto' }), m, 'pt-BR')).toBe(
      m.unidadeLabel.a_gosto,
    )
  })

  it('FALLBACK: sem nome E sem medida ⇒ string vazia (descartável)', () => {
    expect(formatIngredientLine(ing({}), m, 'pt-BR')).toBe('')
  })

  it('FALLBACK: quantidade não-numérica (defensivo) sem nome ⇒ sai crua, nunca NaN', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: 'a gosto', unidade: null }), m, 'pt-BR')).toBe('a gosto')
  })
})

/**
 * `scaleQuantidade`/`scaleIngredient` (#452, CONTEXT.md:192): aritmética PURA `quantidade × ratio`
 * do escalador de porções — nunca geração/reprocessamento de texto. Testes puros, sem `Messages`.
 */
describe('scaleQuantidade — aritmética do escalador de porções (#452)', () => {
  it('escala pelo fator e arredonda a 3 casas (espelha numeric(10,3))', () => {
    expect(scaleQuantidade('2', 1.5)).toBe('3')
    expect(scaleQuantidade('2.500', 2)).toBe('5')
    expect(scaleQuantidade('1', 1 / 3)).toBe('0.333')
  })

  it('fator 1 (porções inalteradas) é identidade numérica', () => {
    expect(scaleQuantidade('2.500', 1)).toBe('2.5')
  })

  it('aceita vírgula decimal na entrada (defensivo)', () => {
    expect(scaleQuantidade('2,5', 2)).toBe('5')
  })

  it('null/vazio ficam como estão (nada a escalar)', () => {
    expect(scaleQuantidade(null, 2)).toBeNull()
    expect(scaleQuantidade('', 2)).toBe('')
  })

  it('não-numérico (defensivo) sai cru, nunca NaN', () => {
    expect(scaleQuantidade('a gosto', 2)).toBe('a gosto')
  })
})

describe('scaleIngredient — escala só `quantidade`; `unidade`/`rawText` intactos (#452)', () => {
  it('escala a quantidade preservando unidade e nome', () => {
    const item = ing({ rawText: 'farinha', quantidade: '200', unidade: 'g' })
    expect(scaleIngredient(item, 2)).toEqual({ ...item, quantidade: '400' })
  })

  it('item SEM quantidade estruturada fica como está (devolve o MESMO objeto)', () => {
    const item = ing({ rawText: 'sal', quantidade: null, unidade: 'a_gosto' })
    expect(scaleIngredient(item, 3)).toBe(item)
  })

  it('round-trip com formatIngredientLine: "2 dentes de alho" → escala 2× → "4 dentes de alho"', () => {
    const item = ing({ rawText: 'alho', quantidade: '2', unidade: 'dente' })
    expect(formatIngredientLine(scaleIngredient(item, 2), m, 'pt-BR')).toBe('4 dentes de alho')
  })
})

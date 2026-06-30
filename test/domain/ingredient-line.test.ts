import { describe, it, expect } from 'vitest'
import { formatIngredientLine } from '@/domain/ingredient-line'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { IngredientView } from '@/domain/recipe-read'

/**
 * `formatIngredientLine` — fonte ÚNICA da linha de ingrediente exibida (detalhe + JSON-LD). O bug que
 * motivou: a medida estruturada era RE-prefixada a uma `rawText` que JÁ era a linha humana completa,
 * duplicando ("320 g — 320 g de arroz arbóreo"). Contrato: `rawText` é a linha completa ⇒ exibe-a
 * direto; `quantidade`/`unidade` só viram display no FALLBACK (rawText ausente/vazio).
 */
const m = ptBR
function ing(over: Partial<IngredientView>): IngredientView {
  return { ordem: 1, quantidade: null, unidade: null, rawText: null, ...over } as IngredientView
}

describe('formatIngredientLine', () => {
  it('rawText linha-completa + medida estruturada ⇒ exibe SÓ a rawText (NÃO duplica)', () => {
    expect(
      formatIngredientLine(ing({ rawText: '320 g de arroz arbóreo', quantidade: '320', unidade: 'g' }), m),
    ).toBe('320 g de arroz arbóreo')
  })

  it('"a gosto" embutido na rawText + unidade a_gosto ⇒ sem "a gosto — a gosto"', () => {
    expect(formatIngredientLine(ing({ rawText: 'Sal a gosto', unidade: 'a_gosto' }), m)).toBe('Sal a gosto')
  })

  it('quantidade fracionária com unidade composta NÃO re-prefixa quando rawText existe', () => {
    expect(
      formatIngredientLine(
        ing({ rawText: '2 colheres de sopa de azeite', quantidade: '2.500', unidade: 'colher_de_sopa' }),
        m,
      ),
    ).toBe('2 colheres de sopa de azeite')
  })

  it('FALLBACK: rawText ausente ⇒ medida estruturada (quantidade normalizada + unidade LOCALIZADA)', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: '2.500', unidade: 'colher_de_sopa' }), m)).toBe(
      `2.5 ${m.unidadeLabel.colher_de_sopa}`,
    )
  })

  it('FALLBACK: rawText whitespace tratada como ausente ⇒ cai na medida', () => {
    expect(formatIngredientLine(ing({ rawText: '   ', quantidade: '3.000', unidade: 'unidade' }), m)).toBe(
      `3 ${m.unidadeLabel.unidade}`,
    )
  })

  it('sem rawText E sem medida ⇒ string vazia (descartável)', () => {
    expect(formatIngredientLine(ing({}), m)).toBe('')
  })

  it('quantidade não-numérica (defensivo) no fallback ⇒ sai crua, nunca NaN', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: 'a gosto', unidade: null }), m)).toBe('a gosto')
  })
})

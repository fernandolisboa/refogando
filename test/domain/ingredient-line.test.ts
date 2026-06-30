import { describe, it, expect } from 'vitest'
import { formatIngredientLine } from '@/domain/ingredient-line'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { IngredientView } from '@/domain/recipe-read'

/**
 * `formatIngredientLine` — fonte ÚNICA da linha de ingrediente exibida (detalhe + JSON-LD).
 *
 * CONTRATO (ADR-0012 Adendo 2026-06-30, Direção B): a medida estruturada (`quantidade`/`unidade`)
 * é a fonte ÚNICA da medida; `rawText` é o NOME do ingrediente SEM a medida ("arroz arbóreo"). A
 * exibição COMPÕE "medida — nome" (em-dash, zero gramática):
 *   - não-contável (g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada):
 *     "{qtd} {unitLabel} — {nome}" (não pluraliza a unidade);
 *   - contável (`unidade`): larga a palavra "unidade" → "{qtd} {nome}" ("2 cebolas");
 *   - `a_gosto`/`q_b`: SUFIXO → "{nome} — a gosto" / "{nome} — q.b.";
 *   - sem medida (qty null + unidade null): só "{nome}".
 * O FALLBACK defensivo (nome ausente/vazio — não ocorre em prod pós-migração) exibe só a medida
 * estruturada localizada, ao menos.
 *
 * Supera o remendo do PR #354, que exibia `rawText` cru (a linha humana completa) e por isso
 * DUPLICARIA a medida ("320 g — 320 g de arroz arbóreo") quando o display voltasse a compor.
 */
const m = ptBR
function ing(over: Partial<IngredientView>): IngredientView {
  return { ordem: 1, quantidade: null, unidade: null, rawText: null, ...over } as IngredientView
}

describe('formatIngredientLine — composição medida + nome (Direção B)', () => {
  it('não-contável (g): "{qtd} {unitLabel} — {nome}" com em-dash', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'arroz arbóreo', quantidade: '320', unidade: 'g' }), m),
    ).toBe('320 g — arroz arbóreo')
  })

  it('não-contável composta (colher_de_sopa): unidade LOCALIZADA, quantidade normalizada, ZERO gramática (não pluraliza)', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'azeite', quantidade: '2.500', unidade: 'colher_de_sopa' }), m),
    ).toBe(`2.5 ${m.unidadeLabel.colher_de_sopa} — azeite`)
  })

  it('não-contável (xicara): "2 xícara — feijão" (singular, locale-neutro)', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'feijão', quantidade: '2.000', unidade: 'xicara' }), m),
    ).toBe(`2 ${m.unidadeLabel.xicara} — feijão`)
  })

  it('não-contável (dente): "2 dente — alho"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'alho', quantidade: '2', unidade: 'dente' }), m),
    ).toBe(`2 ${m.unidadeLabel.dente} — alho`)
  })

  it('contável (`unidade`): LARGA a palavra "unidade" → "{qtd} {nome}"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cebolas', quantidade: '2', unidade: 'unidade' }), m),
    ).toBe('2 cebolas')
  })

  it('contável (`unidade`) com quantidade fracionária normalizada: "1.5 abobrinhas"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'abobrinhas', quantidade: '1.500', unidade: 'unidade' }), m),
    ).toBe('1.5 abobrinhas')
  })

  it('contável (`unidade`) SEM quantidade ⇒ só o nome', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cebola picada', quantidade: null, unidade: 'unidade' }), m),
    ).toBe('cebola picada')
  })

  it('a_gosto: SUFIXO "{nome} — a gosto"', () => {
    expect(formatIngredientLine(ing({ rawText: 'sal', unidade: 'a_gosto' }), m)).toBe(
      `sal — ${m.unidadeLabel.a_gosto}`,
    )
  })

  it('q_b: SUFIXO "{nome} — q.b."', () => {
    expect(formatIngredientLine(ing({ rawText: 'fermento', unidade: 'q_b' }), m)).toBe(
      `fermento — ${m.unidadeLabel.q_b}`,
    )
  })

  it('a_gosto com quantidade (defensivo): a qty é IGNORADA no sufixo (a_gosto não carrega número)', () => {
    expect(formatIngredientLine(ing({ rawText: 'pimenta', quantidade: '1', unidade: 'a_gosto' }), m)).toBe(
      `pimenta — ${m.unidadeLabel.a_gosto}`,
    )
  })

  it('quantidade SEM unidade (ex.: importação "3 cenouras médias") ⇒ "{qtd} {nome}"', () => {
    expect(
      formatIngredientLine(ing({ rawText: 'cenouras médias', quantidade: '3', unidade: null }), m),
    ).toBe('3 cenouras médias')
  })

  it('sem medida (qty null + unidade null) ⇒ só o nome', () => {
    expect(formatIngredientLine(ing({ rawText: 'folhas de louro' }), m)).toBe('folhas de louro')
  })

  it('o token cru do enum NUNCA aparece (unidade é sempre LOCALIZADA)', () => {
    const line = formatIngredientLine(ing({ rawText: 'azeite', quantidade: '2', unidade: 'colher_de_sopa' }), m)
    expect(line).not.toMatch(/colher_de_sopa/)
  })

  it('NÃO duplica: nome já SEM medida + medida estruturada ⇒ a medida aparece UMA vez', () => {
    const line = formatIngredientLine(ing({ rawText: 'arroz arbóreo', quantidade: '320', unidade: 'g' }), m)
    expect(line).toBe('320 g — arroz arbóreo')
    // Regressão do bug que motivou a Direção B: nada de "320 g — 320 g de arroz arbóreo".
    expect(line.match(/320 g/g)).toHaveLength(1)
  })

  // ── FALLBACK defensivo: nome ausente/vazio (não ocorre em prod pós-migração) ───────
  it('FALLBACK: nome ausente ⇒ medida estruturada (quantidade normalizada + unidade LOCALIZADA)', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: '2.500', unidade: 'colher_de_sopa' }), m)).toBe(
      `2.5 ${m.unidadeLabel.colher_de_sopa}`,
    )
  })

  it('FALLBACK: nome só-espaços tratado como ausente ⇒ cai na medida', () => {
    expect(formatIngredientLine(ing({ rawText: '   ', quantidade: '3.000', unidade: 'unidade' }), m)).toBe(
      `3 ${m.unidadeLabel.unidade}`,
    )
  })

  it('FALLBACK: a_gosto sem nome ⇒ só o rótulo ("a gosto")', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: null, unidade: 'a_gosto' }), m)).toBe(
      m.unidadeLabel.a_gosto,
    )
  })

  it('FALLBACK: sem nome E sem medida ⇒ string vazia (descartável)', () => {
    expect(formatIngredientLine(ing({}), m)).toBe('')
  })

  it('FALLBACK: quantidade não-numérica (defensivo) sem nome ⇒ sai crua, nunca NaN', () => {
    expect(formatIngredientLine(ing({ rawText: null, quantidade: 'a gosto', unidade: null }), m)).toBe('a gosto')
  })
})

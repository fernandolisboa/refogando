import { describe, expect, it } from 'vitest'
import { parseSearchTerms, parseMatchMode, MAX_TERMS } from '@/domain/search-terms'

/**
 * Unit puro (#9, §4.2) de `parseSearchTerms` + `parseMatchMode` — a extração de termos
 * do `?q=` que alimenta o eixo de ingrediente, e o modo any/all. Sem DB, sem I/O.
 *
 * O route corta `q` a `MAX_QUERY_LEN` ANTES de chamar `parseSearchTerms`; aqui provamos
 * só o contrato da função pura: split por vírgula, trim, drop-vazios, sanitize C0,
 * cap a MAX_TERMS. A normalização canônica (fold espaço/hífen/acento/case) NÃO vive
 * aqui — é SQL, provada pela integração (AC5).
 */

describe('parseSearchTerms (#9, extração pura de termos)', () => {
  it('split por vírgula + trim de cada termo', () => {
    expect(parseSearchTerms('frango, limão , alho')).toEqual(['frango', 'limão', 'alho'])
  })

  it('dropa termos vazios entre vírgulas', () => {
    expect(parseSearchTerms('frango,,alho')).toEqual(['frango', 'alho'])
  })

  it('só-vírgulas (",,,") → array vazio (N=0; o route força effectiveMode=any)', () => {
    expect(parseSearchTerms(',,,')).toEqual([])
  })

  it('string vazia → array vazio', () => {
    expect(parseSearchTerms('')).toEqual([])
  })

  it('termo multi-palavra sem vírgula → UM termo (só a vírgula separa)', () => {
    // 'cebola roxa' é um único termo; o espaço interno NÃO é separador (AC5 depende
    // de o termo inteiro chegar ao fold hífen→espaço da resolução canônica).
    expect(parseSearchTerms('cebola roxa')).toEqual(['cebola roxa'])
  })

  it('sanitiza bytes de controle C0 por termo (NUL → espaço, depois trim)', () => {
    // NUL embutido vira espaço; trim das pontas remove o byte de controle solto.
    expect(parseSearchTerms('fra\x00ngo')).toEqual(['fra ngo'])
    expect(parseSearchTerms('\x00frango\x00')).toEqual(['frango'])
    // C0 isolado por termo → trim para vazio → dropado.
    expect(parseSearchTerms('frango,\x01,alho')).toEqual(['frango', 'alho'])
  })

  it('um termo que vira só-espaço após sanitize C0 é dropado', () => {
    expect(parseSearchTerms('\x07')).toEqual([])
  })

  it('capa o array a MAX_TERMS (anti-fan-out do CROSS JOIN da degradação raw_text)', () => {
    // Termos DISTINTOS (t0..tN): pós-dedup o comprimento ainda excede MAX_TERMS, então o
    // cap é o que limita — independe do dedup.
    const many = Array.from({ length: MAX_TERMS + 10 }, (_, i) => `t${i}`).join(',')
    const out = parseSearchTerms(many)
    expect(out).toHaveLength(MAX_TERMS)
    expect(out[0]).toBe('t0')
    expect(out[MAX_TERMS - 1]).toBe(`t${MAX_TERMS - 1}`)
  })

  it('dedup de termos distintos ANTES do cap (q="frango,frango" não dobra o overlap)', () => {
    // Termos repetidos colapsam a um só → uma Receita de frango ganha overlap 1, não 2.
    expect(parseSearchTerms('frango,frango')).toEqual(['frango'])
    // Dedup preserva a ordem da PRIMEIRA ocorrência.
    expect(parseSearchTerms('frango,alho,frango,limão,alho')).toEqual([
      'frango',
      'alho',
      'limão',
    ])
    // Dedup vem ANTES do cap: termos distintos preenchem o orçamento mesmo com repetições
    // no meio. 'dup' aparece duas vezes; o resto são MAX_TERMS termos distintos → o array
    // pós-dedup tem MAX_TERMS+1 distintos e o cap o trunca a MAX_TERMS.
    const withDup =
      'dup,' + Array.from({ length: MAX_TERMS }, (_, i) => `u${i}`).join(',') + ',dup'
    const out = parseSearchTerms(withDup)
    expect(out).toHaveLength(MAX_TERMS)
    expect(out[0]).toBe('dup')
    expect(new Set(out).size).toBe(MAX_TERMS) // sem repetições no resultado
  })
})

describe('parseMatchMode (#9, modo permissivo)', () => {
  it("'all' explícito → 'all'", () => {
    expect(parseMatchMode('all')).toBe('all')
  })

  it("'any' → 'any'", () => {
    expect(parseMatchMode('any')).toBe('any')
  })

  it('ausente (null) → default permissivo any', () => {
    expect(parseMatchMode(null)).toBe('any')
  })

  it('qualquer lixo (não-"all") → any', () => {
    expect(parseMatchMode('lixo')).toBe('any')
    expect(parseMatchMode('ALL')).toBe('any') // case-sensitive: só 'all' minúsculo
    expect(parseMatchMode('')).toBe('any')
  })
})

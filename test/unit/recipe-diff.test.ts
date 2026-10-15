import { describe, expect, it } from 'vitest'
import {
  decideDerivedDiff,
  DERIVED_DIFF_VERSION,
  isEmptyDiff,
  pruneNoopChanges,
  quantidadesIguais,
  stepChanges,
  type DerivedDiff,
  type DiffLado,
} from '@/domain/recipe-diff'

/**
 * Matriz pura de `decideDerivedDiff` (issue #17). Total/determinística/sem-throw: a forma
 * congelada (`v:1` + ingredientes + restricoes + campos) é o contrato que `derive.ts`
 * armazena em `recipe.derived_diff` e que o leitor #61 renderiza por rótulos.
 */

function lado(over: Partial<DiffLado> = {}): DiffLado {
  return {
    titulo: 'Bolo de fubá',
    descricao: 'Bolo simples de fubá.',
    passos: ['Misture.', 'Asse.'],
    ingredientes: [
      { nome: 'fubá', quantidade: '2.000' },
      { nome: 'açúcar', quantidade: '1.000' },
    ],
    restricoes: ['sem_lactose'],
    ...over,
  }
}

describe('decideDerivedDiff — diff derivado congelado (#17)', () => {
  it('sem mudança: arrays vazios, campos vazio, versão fixa', () => {
    const base = lado()
    const diff = decideDerivedDiff({ base, edits: lado() })
    expect(diff.v).toBe(DERIVED_DIFF_VERSION)
    expect(diff.v).toBe(1)
    expect(diff.ingredientes).toEqual({ adicionados: [], removidos: [], quantidadeAlterada: [] })
    expect(diff.restricoes).toEqual({ adicionadas: [], removidas: [] })
    expect(diff.campos).toEqual({})
  })

  it('ingrediente adicionado', () => {
    const base = lado({ ingredientes: [{ nome: 'fubá', quantidade: '2.000' }] })
    const edits = lado({
      ingredientes: [
        { nome: 'fubá', quantidade: '2.000' },
        { nome: 'erva-doce', quantidade: null },
      ],
    })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.adicionados).toEqual(['erva-doce'])
    expect(diff.ingredientes.removidos).toEqual([])
    expect(diff.ingredientes.quantidadeAlterada).toEqual([])
  })

  it('ingrediente removido', () => {
    const base = lado({
      ingredientes: [
        { nome: 'fubá', quantidade: '2.000' },
        { nome: 'açúcar', quantidade: '1.000' },
      ],
    })
    const edits = lado({ ingredientes: [{ nome: 'fubá', quantidade: '2.000' }] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.removidos).toEqual(['açúcar'])
    expect(diff.ingredientes.adicionados).toEqual([])
  })

  it('quantidade alterada (string|null, nunca number)', () => {
    const base = lado({ ingredientes: [{ nome: 'fubá', quantidade: '2.000' }] })
    const edits = lado({ ingredientes: [{ nome: 'fubá', quantidade: '3.000' }] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.quantidadeAlterada).toEqual([
      { nome: 'fubá', de: '2.000', para: '3.000' },
    ])
    expect(diff.ingredientes.adicionados).toEqual([])
    expect(diff.ingredientes.removidos).toEqual([])
  })

  it('quantidade null→valor conta como alteração', () => {
    const base = lado({ ingredientes: [{ nome: 'sal', quantidade: null }] })
    const edits = lado({ ingredientes: [{ nome: 'sal', quantidade: '5.000' }] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.quantidadeAlterada).toEqual([
      { nome: 'sal', de: null, para: '5.000' },
    ])
  })

  it('restrição adicionada e removida', () => {
    const base = lado({ restricoes: ['sem_lactose'] })
    const edits = lado({ restricoes: ['vegano'] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.restricoes.adicionadas).toEqual(['vegano'])
    expect(diff.restricoes.removidas).toEqual(['sem_lactose'])
  })

  it('campo titulo alterado (de/para)', () => {
    const base = lado({ titulo: 'Bolo de fubá' })
    const edits = lado({ titulo: 'Bolo de fubá com erva-doce' })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.campos.titulo).toEqual({ de: 'Bolo de fubá', para: 'Bolo de fubá com erva-doce' })
    expect(diff.campos.descricao).toBeUndefined()
    expect(diff.campos.passos).toBeUndefined()
  })

  it('campo descricao null→texto', () => {
    const base = lado({ descricao: null })
    const edits = lado({ descricao: 'Agora com descrição.' })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.campos.descricao).toEqual({ de: null, para: 'Agora com descrição.' })
  })

  it('campo passos: listas inteiras de/para quando diferem', () => {
    const base = lado({ passos: ['Misture.', 'Asse.'] })
    const edits = lado({ passos: ['Misture.', 'Asse.', 'Decore.'] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.campos.passos).toEqual({
      de: ['Misture.', 'Asse.'],
      para: ['Misture.', 'Asse.', 'Decore.'],
    })
  })

  it('passos iguais (mesma ordem/conteúdo) ⇒ ausente', () => {
    const base = lado({ passos: ['A', 'B'] })
    const edits = lado({ passos: ['A', 'B'] })
    expect(decideDerivedDiff({ base, edits }).campos.passos).toBeUndefined()
  })

  // ADR-0045: "sem passos" é "sem passos" para quem lê — null e [] deixaram de contar como mudança.
  it('passos null vs [] são iguais (nenhum passo nos dois lados)', () => {
    const base = lado({ passos: null })
    const edits = lado({ passos: [] })
    expect(decideDerivedDiff({ base, edits }).campos.passos).toBeUndefined()
  })

  it('byte-estável: duas chamadas idênticas produzem o MESMO JSON', () => {
    const base = lado()
    const edits = lado({
      titulo: 'Outro',
      ingredientes: [
        { nome: 'fubá', quantidade: '3.000' },
        { nome: 'novo', quantidade: null },
      ],
      restricoes: ['vegano'],
    })
    const a = JSON.stringify(decideDerivedDiff({ base, edits }))
    const b = JSON.stringify(decideDerivedDiff({ base, edits }))
    expect(a).toBe(b)
  })

  it('matriz combinada: add + remove + qty + restrição + campos juntos', () => {
    const base = lado({
      titulo: 'Base',
      descricao: 'desc base',
      passos: ['p1'],
      ingredientes: [
        { nome: 'fubá', quantidade: '2.000' },
        { nome: 'açúcar', quantidade: '1.000' },
      ],
      restricoes: ['sem_lactose', 'sem_gluten'],
    })
    const edits = lado({
      titulo: 'Editada',
      descricao: 'desc base', // inalterada
      passos: ['p1', 'p2'],
      ingredientes: [
        { nome: 'fubá', quantidade: '5.000' }, // qty mudou
        { nome: 'erva-doce', quantidade: null }, // adicionado (açúcar removido)
      ],
      restricoes: ['sem_gluten', 'vegano'], // sem_lactose removida, vegano adicionada
    })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.adicionados).toEqual(['erva-doce'])
    expect(diff.ingredientes.removidos).toEqual(['açúcar'])
    expect(diff.ingredientes.quantidadeAlterada).toEqual([
      { nome: 'fubá', de: '2.000', para: '5.000' },
    ])
    expect(diff.restricoes.adicionadas).toEqual(['vegano'])
    expect(diff.restricoes.removidas).toEqual(['sem_lactose'])
    expect(diff.campos.titulo).toEqual({ de: 'Base', para: 'Editada' })
    expect(diff.campos.descricao).toBeUndefined()
    expect(diff.campos.passos).toEqual({ de: ['p1'], para: ['p1', 'p2'] })
  })
})

/**
 * ADR-0045: igualdade SEMÂNTICA. O form devolve as coisas noutra forma que o banco guarda
 * ("3.000" → "3", textos aparados, passos um por linha). Uma cópia sem mudança nenhuma não pode
 * listar "sal: 3 → 3".
 */
describe('decideDerivedDiff — igualdade semântica (ADR-0045)', () => {
  it('cópia sem mudança, na forma que o form devolve ⇒ diff vazio', () => {
    const base = lado({
      titulo: 'Bolo de fubá ',
      descricao: 'Bolo simples de fubá.\n',
      passos: ['Misture.\nBata bem.', '', 'Asse.'],
      ingredientes: [
        { nome: 'fubá ', quantidade: '2.000' },
        { nome: 'açúcar', quantidade: '0.500' },
        { nome: 'sal', quantidade: null },
      ],
    })
    const doForm = lado({
      titulo: 'Bolo de fubá',
      descricao: 'Bolo simples de fubá.',
      passos: ['Misture.', 'Bata bem.', 'Asse.'],
      ingredientes: [
        { nome: 'fubá', quantidade: '2' },
        { nome: 'açúcar', quantidade: '0.5' },
        { nome: 'sal', quantidade: null },
      ],
    })
    const diff = decideDerivedDiff({ base, edits: doForm })
    expect(isEmptyDiff(diff)).toBe(true)
  })

  it('descrição vazia ⇔ null; quantidade "" ⇔ null', () => {
    const base = lado({ descricao: '', ingredientes: [{ nome: 'sal', quantidade: '' }] })
    const edits = lado({ descricao: null, ingredientes: [{ nome: 'sal', quantidade: null }] })
    expect(isEmptyDiff(decideDerivedDiff({ base, edits }))).toBe(true)
  })

  it('mudança real de quantidade continua aparecendo, com os valores originais', () => {
    const base = lado({ ingredientes: [{ nome: 'fubá', quantidade: '2.000' }] })
    const edits = lado({ ingredientes: [{ nome: 'fubá', quantidade: '2.5' }] })
    const diff = decideDerivedDiff({ base, edits })
    expect(diff.ingredientes.quantidadeAlterada).toEqual([{ nome: 'fubá', de: '2.000', para: '2.5' }])
  })

  it('quantidadesIguais: número compara por valor; texto não-numérico compara aparado', () => {
    expect(quantidadesIguais('3.000', '3')).toBe(true)
    expect(quantidadesIguais('3.000', '3.5')).toBe(false)
    expect(quantidadesIguais(null, '0')).toBe(false)
    expect(quantidadesIguais(' a gosto ', 'a gosto')).toBe(true)
    expect(quantidadesIguais('abc', 'abd')).toBe(false)
    expect(quantidadesIguais('0.5004', '0.500')).toBe(true) // numeric(10,3) grava igual
  })
})

describe('pruneNoopChanges — poda na leitura de diffs antigos (ADR-0045)', () => {
  const ruidoso: DerivedDiff = {
    v: 1,
    ingredientes: {
      adicionados: ['sal', 'queijo'],
      removidos: ['sal ', 'pimenta'],
      quantidadeAlterada: [
        { nome: 'fubá', de: '3.000', para: '3' },
        { nome: 'leite', de: '1.000', para: '2' },
      ],
    },
    restricoes: { adicionadas: [], removidas: [] },
    campos: {
      titulo: { de: 'Bolo ', para: 'Bolo' },
      descricao: { de: 'Velha', para: 'Nova' },
      passos: { de: ['A.', '', 'B.'], para: ['A.', 'B.'] },
    },
  }

  it('descarta só o que não muda nada; mantém as mudanças reais', () => {
    const p = pruneNoopChanges(ruidoso)
    expect(p.ingredientes).toEqual({
      adicionados: ['queijo'],
      removidos: ['pimenta'],
      quantidadeAlterada: [{ nome: 'leite', de: '1.000', para: '2' }],
    })
    expect(p.campos).toEqual({ descricao: { de: 'Velha', para: 'Nova' } })
  })

  it('é idempotente e não muta a entrada', () => {
    const copia = structuredClone(ruidoso)
    const p = pruneNoopChanges(ruidoso)
    expect(pruneNoopChanges(p)).toEqual(p)
    expect(ruidoso).toEqual(copia)
  })

  it('o caso relatado (cópia sem mudança, "3.000 → 3") fica vazio', () => {
    const relatado: DerivedDiff = {
      v: 1,
      ingredientes: { adicionados: [], removidos: [], quantidadeAlterada: [{ nome: 'ovo', de: '3.000', para: '3' }] },
      restricoes: { adicionadas: [], removidas: [] },
      campos: {},
    }
    expect(isEmptyDiff(pruneNoopChanges(relatado))).toBe(true)
  })
})

describe('stepChanges — só os passos que entraram/saíram (ADR-0045)', () => {
  it('troca de um passo', () => {
    expect(stepChanges(['A.', 'B.', 'C.'], ['A.', 'B2.', 'C.'])).toEqual({
      adicionados: ['B2.'],
      removidos: ['B.'],
      reordenados: false,
    })
  })

  it('passo repetido conta como multiconjunto', () => {
    expect(stepChanges(['Mexa.', 'Mexa.'], ['Mexa.'])).toEqual({
      adicionados: [],
      removidos: ['Mexa.'],
      reordenados: false,
    })
  })

  it('só reordenou', () => {
    expect(stepChanges(['A.', 'B.'], ['B.', 'A.'])).toEqual({ adicionados: [], removidos: [], reordenados: true })
  })

  it('null de um lado', () => {
    expect(stepChanges(null, ['A.'])).toEqual({ adicionados: ['A.'], removidos: [], reordenados: false })
  })
})

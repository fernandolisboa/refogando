import { describe, expect, it } from 'vitest'
import {
  shouldSuggestNewImage,
  visualChangesFromDiff,
  visualChangesBetween,
  ingredientSetChanged,
  VISUAL_FIELDS,
} from '@/domain/image-review'
import { DERIVED_DIFF_VERSION, type DerivedDiff } from '@/domain/recipe-diff'

/**
 * Classificador da revisão de imagem ao versionar (#131, ADR-0016). PURO/total. Visual (grande):
 * ingredientes(conjunto)/título/cozinha. Cosmético (silencioso): porções/dificuldade/notas/
 * descrição/restrições/quantidade. Sugere SÓ quando há imagem herdada E houve mudança visual.
 */

/** DerivedDiff base "sem mudança" — os casos sobrescrevem pontualmente. */
function diff(over: Partial<DerivedDiff> = {}): DerivedDiff {
  return {
    v: DERIVED_DIFF_VERSION,
    ingredientes: { adicionados: [], removidos: [], quantidadeAlterada: [] },
    restricoes: { adicionadas: [], removidas: [] },
    campos: {},
    ...over,
  }
}

describe('shouldSuggestNewImage — gate de imagem + campos visuais (#131)', () => {
  it('sem imagem herdada ⇒ NUNCA sugere (nem com mudança visual)', () => {
    expect(shouldSuggestNewImage({ hasImage: false, changed: ['titulo', 'ingredientes', 'cozinha'] })).toBe(false)
  })

  it.each(VISUAL_FIELDS)('com imagem + campo visual "%s" ⇒ sugere', (field) => {
    expect(shouldSuggestNewImage({ hasImage: true, changed: [field] })).toBe(true)
  })

  it('com imagem mas só campos cosméticos ⇒ silencioso', () => {
    for (const f of ['porcoes', 'dificuldade', 'notas', 'descricao', 'restricoes', 'quantidade', 'passos', 'categoria']) {
      expect(shouldSuggestNewImage({ hasImage: true, changed: [f] })).toBe(false)
    }
  })

  it('visual + cosmético juntos ⇒ o visual vence (sugere)', () => {
    expect(shouldSuggestNewImage({ hasImage: true, changed: ['notas', 'titulo'] })).toBe(true)
  })

  it('nenhuma mudança ⇒ silencioso', () => {
    expect(shouldSuggestNewImage({ hasImage: true, changed: [] })).toBe(false)
  })
})

describe('visualChangesFromDiff — extrai campos visuais do DerivedDiff (derivar/#17)', () => {
  it('título mudado ⇒ ["titulo"]', () => {
    expect(visualChangesFromDiff(diff({ campos: { titulo: { de: 'A', para: 'B' } } }))).toEqual(['titulo'])
  })

  it('ingrediente adicionado ⇒ ["ingredientes"]', () => {
    expect(visualChangesFromDiff(diff({ ingredientes: { adicionados: ['ovo'], removidos: [], quantidadeAlterada: [] } }))).toEqual(['ingredientes'])
  })

  it('ingrediente removido ⇒ ["ingredientes"]', () => {
    expect(visualChangesFromDiff(diff({ ingredientes: { adicionados: [], removidos: ['leite'], quantidadeAlterada: [] } }))).toEqual(['ingredientes'])
  })

  it('SÓ quantidade alterada ⇒ [] (cosmético — o prato parece o mesmo)', () => {
    expect(
      visualChangesFromDiff(diff({ ingredientes: { adicionados: [], removidos: [], quantidadeAlterada: [{ nome: 'sal', de: '1', para: '2' }] } })),
    ).toEqual([])
  })

  it('SÓ descrição/passos/restrições ⇒ [] (cosmético)', () => {
    const d = diff({
      campos: { descricao: { de: 'x', para: 'y' }, passos: { de: ['a'], para: ['b'] } },
      restricoes: { adicionadas: ['vegano'], removidas: [] },
    })
    expect(visualChangesFromDiff(d)).toEqual([])
  })

  it('título + ingrediente ⇒ ambos', () => {
    const d = diff({
      campos: { titulo: { de: 'A', para: 'B' } },
      ingredientes: { adicionados: ['ovo'], removidos: [], quantidadeAlterada: [] },
    })
    expect(visualChangesFromDiff(d).sort()).toEqual(['ingredientes', 'titulo'])
  })
})

describe('visualChangesBetween — comparação de snapshots (regenerar/#20)', () => {
  const base = { titulo: 'Bolo', cozinha: 'brasileira', ingredientes: ['farinha', 'ovo'] }

  it('idêntico ⇒ [] (silencioso)', () => {
    expect(visualChangesBetween(base, { ...base })).toEqual([])
  })

  it('título diferente ⇒ ["titulo"]', () => {
    expect(visualChangesBetween(base, { ...base, titulo: 'Torta' })).toEqual(['titulo'])
  })

  it('cozinha diferente ⇒ ["cozinha"]', () => {
    expect(visualChangesBetween(base, { ...base, cozinha: 'italiana' })).toEqual(['cozinha'])
  })

  it('conjunto de ingredientes diferente ⇒ ["ingredientes"]', () => {
    expect(visualChangesBetween(base, { ...base, ingredientes: ['farinha', 'chocolate'] })).toEqual(['ingredientes'])
  })

  it('mesma lista em ordem diferente / com duplicatas ⇒ [] (igualdade de CONJUNTO)', () => {
    expect(visualChangesBetween(base, { ...base, ingredientes: ['ovo', 'farinha', 'ovo'] })).toEqual([])
  })

  it('cozinha null↔valor conta como mudança', () => {
    expect(visualChangesBetween({ ...base, cozinha: null }, base)).toEqual(['cozinha'])
  })

  it('os TRÊS eixos mudam juntos ⇒ todos', () => {
    const after = { titulo: 'Torta', cozinha: 'italiana', ingredientes: ['massa'] }
    expect(visualChangesBetween(base, after).sort()).toEqual(['cozinha', 'ingredientes', 'titulo'])
  })

  it('superconjunto e subconjunto de ingredientes ⇒ ambos disparam ["ingredientes"]', () => {
    expect(visualChangesBetween(base, { ...base, ingredientes: ['farinha', 'ovo', 'leite'] })).toEqual(['ingredientes'])
    expect(visualChangesBetween(base, { ...base, ingredientes: ['farinha'] })).toEqual(['ingredientes'])
  })
})

describe('ingredientSetChanged — mudança de conjunto (edição in-place #21)', () => {
  it('mesmo conjunto (ordem/duplicata/quantidade irrelevantes) ⇒ false', () => {
    expect(ingredientSetChanged(['arroz', 'feijão'], ['feijão', 'arroz', 'feijão'])).toBe(false)
  })
  it('conjunto diferente ⇒ true', () => {
    expect(ingredientSetChanged(['arroz'], ['arroz', 'feijão'])).toBe(true)
    expect(ingredientSetChanged(['arroz', 'feijão'], ['tofu'])).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  parseFacetParams,
  isFacetsEmpty,
  EMPTY_FACETS,
  MAX_FACET_VALUES,
} from '@/domain/facet-params'
import { COZINHAS } from '@/domain/vocabulary'

/**
 * Unit do parse de params de faceta (#10): degradação permissiva na borda (valor inválido
 * ⇒ descartado, NUNCA lança), validação contra o Vocabulário ANTES do bind em enum,
 * faixas numéricas, fold de tag, dedup, cap. Sem DB.
 *
 * #316: cozinha virou DATA-DRIVEN — `parseFacetParams` recebe o conjunto ATIVO injetado. Os
 * casos pré-existentes injetam `ACTIVE = new Set(COZINHAS)` (as 14 enum-storáveis), provando
 * que o parse segue idêntico ao do enum. O caso americana injeta um conjunto com um slug
 * ativo-mas-não-no-enum, provando que a ACEITAÇÃO é dirigida pelo CONJUNTO, não por COZINHAS.
 */

// Conjunto ATIVO injetado nos casos pré-existentes (as 14 cozinhas enum-storáveis).
const ACTIVE = new Set<string>(COZINHAS)

/** Constrói o lookup `(k) => string | null` a partir de um objeto. */
function get(params: Record<string, string>): (k: string) => string | null {
  return (k) => (k in params ? params[k] : null)
}

describe('parseFacetParams', () => {
  it('cozinha: descarta inválidos individualmente, NÃO lança', () => {
    const f = parseFacetParams(get({ cozinha: 'japonesa,xpto' }), ACTIVE)
    expect(f.cozinhas).toEqual(['japonesa'])
  })

  it('cozinha: eixo inteiro inválido ⇒ vazio (sem-filtro)', () => {
    const f = parseFacetParams(get({ cozinha: 'xpto,foo' }), ACTIVE)
    expect(f.cozinhas).toEqual([])
  })

  it('cozinha: cap DEPOIS da validade — MAX+ lixos antes de um válido NÃO descarta o válido', () => {
    // 16 inválidos distintos (= MAX_FACET_VALUES) seguidos de um válido: se o cap viesse
    // ANTES do filtro de validade, os crus capariam a lista e 'japonesa' cairia ⇒ [].
    const trash = Array.from({ length: MAX_FACET_VALUES }, (_, i) => `x${i}`).join(',')
    const f = parseFacetParams(get({ cozinha: `${trash},japonesa` }), ACTIVE)
    expect(f.cozinhas).toEqual(['japonesa'])
  })

  it('cozinha: ACEITAÇÃO é dirigida pelo conjunto ATIVO injetado, não por COZINHAS (#316)', () => {
    // 'americana' está ATIVO na tabela mas NÃO no enum `cozinha` (até a virada #318). Injetando-a
    // no conjunto, o parse a aceita — prova que o validador é set-driven. O tipo de retorno é
    // Cozinha[], então a checagem do slug não-enumerável precisa do cast `as string[]`.
    const withAmericana = new Set<string>([...COZINHAS, 'americana'])
    const f = parseFacetParams(get({ cozinha: 'italiana,americana' }), withAmericana)
    expect(f.cozinhas as string[]).toEqual(['italiana', 'americana'])
    // E permanece rejeitada quando NÃO está no conjunto injetado.
    const g = parseFacetParams(get({ cozinha: 'italiana,americana' }), ACTIVE)
    expect(g.cozinhas as string[]).toEqual(['italiana'])
  })

  it('categoria: literal de enum válido', () => {
    const f = parseFacetParams(get({ categoria: 'sobremesa' }), ACTIVE)
    expect(f.categorias).toEqual(['sobremesa'])
  })

  it('restricao: CSV de literais válidos', () => {
    const f = parseFacetParams(get({ restricao: 'vegano,sem_gluten' }), ACTIVE)
    expect(f.restricoes).toEqual(['vegano', 'sem_gluten'])
  })

  it('dificuldade_max fora de faixa (99) ⇒ bound ignorado; dentro (3) ⇒ {max:3}', () => {
    expect(parseFacetParams(get({ dificuldade_max: '99' }), ACTIVE).dificuldade).toBeUndefined()
    expect(parseFacetParams(get({ dificuldade_max: '3' }), ACTIVE).dificuldade).toEqual({ max: 3 })
  })

  it('porcoes faixa min+max', () => {
    const f = parseFacetParams(get({ porcoes_min: '2', porcoes_max: '6' }), ACTIVE)
    expect(f.porcoes).toEqual({ min: 2, max: 6 })
  })

  it('exato: dificuldade_min=dificuldade_max ⇒ {min:x,max:x}', () => {
    const f = parseFacetParams(get({ dificuldade_min: '2', dificuldade_max: '2' }), ACTIVE)
    expect(f.dificuldade).toEqual({ min: 2, max: 2 })
  })

  it('tag: fold aplicado (lower + acento) — "Leve,Saudável" ⇒ ["leve","saudavel"]', () => {
    const f = parseFacetParams(get({ tag: 'Leve,Saudável' }), ACTIVE)
    expect(f.tags).toEqual(['leve', 'saudavel'])
  })

  it('tag: fold de hífen — "baixa-caloria" ⇒ "baixa caloria"', () => {
    const f = parseFacetParams(get({ tag: 'baixa-caloria' }), ACTIVE)
    expect(f.tags).toEqual(['baixa caloria'])
  })

  it('dedup por eixo', () => {
    const f = parseFacetParams(get({ cozinha: 'japonesa,japonesa', tag: 'leve,Leve' }), ACTIVE)
    expect(f.cozinhas).toEqual(['japonesa'])
    expect(f.tags).toEqual(['leve'])
  })

  it('cap a MAX_FACET_VALUES', () => {
    // gera MAX+5 cozinhas válidas distintas? Só há 14 cozinhas; usa tags (texto livre).
    const many = Array.from({ length: MAX_FACET_VALUES + 5 }, (_, i) => `tag${i}`).join(',')
    const f = parseFacetParams(get({ tag: many }), ACTIVE)
    expect(f.tags).toHaveLength(MAX_FACET_VALUES)
  })

  it('nenhum param ⇒ isFacetsEmpty true (igual a EMPTY_FACETS)', () => {
    const f = parseFacetParams(get({}), ACTIVE)
    expect(isFacetsEmpty(f)).toBe(true)
    expect(f).toEqual(EMPTY_FACETS)
  })

  it('qualquer eixo presente ⇒ isFacetsEmpty false', () => {
    expect(isFacetsEmpty(parseFacetParams(get({ cozinha: 'japonesa' }), ACTIVE))).toBe(false)
    expect(isFacetsEmpty(parseFacetParams(get({ dificuldade_max: '2' }), ACTIVE))).toBe(false)
    expect(isFacetsEmpty(parseFacetParams(get({ tag: 'leve' }), ACTIVE))).toBe(false)
  })
})

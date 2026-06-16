import { describe, it, expect } from 'vitest'
import {
  resolveCulinaryProfile,
  foldIntent,
  CULINARY_INTENT_MAP,
} from '@/domain/culinary-profile'
import { parseSearchTerms } from '@/domain/search-terms'

/**
 * Unit do Perfil culinário (#10, Fork D): resolver PURO de intenção difusa → facetas
 * resolvidas + q-restante. Sem DB. Trava o contrato `ProfileResolution` (resolved,
 * facetas, remainingQuery) e o fold de #9 replicado em JS (`foldIntent`).
 */

describe('foldIntent', () => {
  it('lower + strip de acento', () => {
    expect(foldIntent('Asiático')).toBe('asiatico')
    expect(foldIntent('Saudável')).toBe('saudavel')
  })

  it('hífen→espaço', () => {
    expect(foldIntent('cebola-roxa')).toBe('cebola roxa')
    expect(foldIntent('baixa-caloria')).toBe('baixa caloria')
  })
})

describe('resolveCulinaryProfile', () => {
  it('"asiático e leve" resolve cozinhas asiáticas + tag/dificuldade de leve; stopword "e" ignorada; q-restante vazio', () => {
    const r = resolveCulinaryProfile('asiático e leve')
    expect(r.resolved).toBe(true)
    expect(r.facetas.cozinhas).toEqual(
      expect.arrayContaining(['japonesa', 'chinesa', 'tailandesa', 'indiana']),
    )
    expect(r.facetas.tags).toContain('leve')
    expect(r.facetas.dificuldade).toEqual({ max: 2 })
    // todos os tokens consumidos (a stopword "e" não vaza) ⇒ q-restante vazio
    expect(r.remainingQuery).toBe('')
  })

  it('"asian and light" resolve igual (language-neutral, en-US)', () => {
    const r = resolveCulinaryProfile('asian and light')
    expect(r.resolved).toBe(true)
    expect(r.facetas.cozinhas).toEqual(
      expect.arrayContaining(['japonesa', 'chinesa', 'tailandesa', 'indiana']),
    )
    expect(r.facetas.tags).toContain('leve')
    expect(r.remainingQuery).toBe('')
  })

  it('"asiático e leve frango" — token não-casado "frango" sobra no q-restante', () => {
    const r = resolveCulinaryProfile('asiático e leve frango')
    expect(r.resolved).toBe(true)
    expect(r.remainingQuery).toBe('frango')
  })

  it('"asiático leve, frango, alho" — re-junta restantes por ", " (parseSearchTerms recupera DOIS termos)', () => {
    const r = resolveCulinaryProfile('asiático leve, frango, alho')
    expect(r.resolved).toBe(true)
    // re-join por ', ' (NÃO por ' '): senão colapsaria em 1 termo e quebraria match=all de #9
    expect(parseSearchTerms(r.remainingQuery)).toEqual(['frango', 'alho'])
  })

  it('"frango,limão" — nada casa ⇒ resolved=false, facetas vazio, remainingQuery === q0 VERBATIM (vírgula preservada)', () => {
    const q0 = 'frango,limão'
    const r = resolveCulinaryProfile(q0)
    expect(r.resolved).toBe(false)
    expect(r.facetas).toEqual({})
    // byte-a-byte: NÃO normaliza espaços nem vírgulas
    expect(r.remainingQuery).toBe(q0)
  })

  it('verbatim preserva espaçamento irregular quando nada casa', () => {
    const q0 = 'frango,  limão verde'
    const r = resolveCulinaryProfile(q0)
    expect(r.resolved).toBe(false)
    expect(r.remainingQuery).toBe(q0)
  })

  it('merge mais-restritivo de faixas quando duas entradas resolvem dificuldade', () => {
    // 'leve' e 'light' resolvem ambos dificuldade {max:2}; o merge mantém o mais restritivo.
    const r = resolveCulinaryProfile('leve light')
    expect(r.resolved).toBe(true)
    expect(r.facetas.dificuldade).toEqual({ max: 2 })
    // tags dedupadas
    expect(r.facetas.tags).toEqual(['leve'])
  })

  it('o mapa tem chaves pt-BR E en-US para os seeds (language-neutral)', () => {
    const keys = Object.keys(CULINARY_INTENT_MAP)
    expect(keys).toEqual(expect.arrayContaining(['asiatico', 'asian', 'leve', 'light']))
  })
})

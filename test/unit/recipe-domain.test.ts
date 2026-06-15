import { describe, expect, it } from 'vitest'
import {
  LINEAGE_KINDS,
  ORIGENS,
  RESULT_KINDS,
  SCHEMA_VERSION_RECEITA,
  TRANSLATION_PROVENANCES,
  VISIBILIDADES,
  isLineageKind,
  isOrigin,
  isResultKind,
  isTranslationProvenance,
  isTranslationReliable,
  isVisibility,
} from '@/domain/recipe'

describe('Espinha da Receita — kernel de domínio', () => {
  it('isOrigin: pertencimento ao selo de proveniência', () => {
    for (const o of ORIGENS) expect(isOrigin(o)).toBe(true)
    expect(isOrigin('catalog')).toBe(true)
    expect(isOrigin('telepatia')).toBe(false)
  })

  it('isVisibility: pertencimento', () => {
    for (const v of VISIBILIDADES) expect(isVisibility(v)).toBe(true)
    expect(isVisibility('private')).toBe(true)
    expect(isVisibility('secreta')).toBe(false)
  })

  it('isResultKind: só success/degraded/playful', () => {
    for (const r of RESULT_KINDS) expect(isResultKind(r)).toBe(true)
    expect(isResultKind('playful')).toBe(true)
    expect(isResultKind('fracasso')).toBe(false)
  })

  it('isLineageKind: só regenerated/edited', () => {
    for (const l of LINEAGE_KINDS) expect(isLineageKind(l)).toBe(true)
    expect(isLineageKind('regenerated')).toBe(true)
    expect(isLineageKind('clonada')).toBe(false)
  })

  it('isTranslationProvenance: pertencimento', () => {
    for (const p of TRANSLATION_PROVENANCES) expect(isTranslationProvenance(p)).toBe(true)
    expect(isTranslationProvenance('escrita_por_pessoa')).toBe(true)
    expect(isTranslationProvenance('chute')).toBe(false)
  })

  it('isTranslationReliable: tabela-verdade (confiável = pessoa OU revisada)', () => {
    expect(isTranslationReliable('escrita_por_pessoa')).toBe(true)
    expect(isTranslationReliable('automatica_revisada')).toBe(true)
    expect(isTranslationReliable('automatica_nao_revisada')).toBe(false)
  })

  it('SCHEMA_VERSION_RECEITA é 1', () => {
    expect(SCHEMA_VERSION_RECEITA).toBe(1)
  })
})

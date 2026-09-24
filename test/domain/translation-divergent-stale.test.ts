import { describe, expect, it } from 'vitest'
import {
  isDefasada,
  isDivergente,
  isDefasadaEDivergente,
  isRetranslateQuarantined,
  retranslateFailKey,
  RETRANSLATE_FAIL_THRESHOLD,
  type DivergentStaleInput,
} from '@/domain/translation-divergent-stale'

// Decisão PURA da lista do Curador (#500, ADR-0031 dec.6): entra quando defasada E divergente.

const V = 2 // TRANSLATION_PROMPT_VERSION de teste (número arbitrário > 1 p/ exercitar o gatilho por-versão)

function base(): DivergentStaleInput {
  return {
    currentSourceFingerprint: 'src-atual',
    storedSourceFingerprint: 'src-atual', // bate ⇒ NÃO defasada por fonte
    storedPromptVersion: V, // bate a versão atual ⇒ NÃO defasada por versão
    translationPromptVersion: V,
    currentMtFingerprint: 'mt-atual',
    storedMtFingerprint: 'mt-atual', // bate ⇒ intocada (NÃO divergente)
  }
}

describe('isDefasada (#500)', () => {
  it('fonte atual ≠ gravada ⇒ defasada', () => {
    expect(isDefasada({ ...base(), currentSourceFingerprint: 'src-novo' })).toBe(true)
  })

  it('promptVersion gravado < atual ⇒ defasada mesmo com fonte igual', () => {
    expect(isDefasada({ ...base(), storedPromptVersion: V - 1 })).toBe(true)
  })

  it('promptVersion NULL (legado) ⇒ sempre defasada (abaixo de qualquer versão)', () => {
    expect(isDefasada({ ...base(), storedPromptVersion: null })).toBe(true)
  })

  it('fonte igual + versão em dia ⇒ NÃO defasada', () => {
    expect(isDefasada(base())).toBe(false)
  })
})

describe('isDivergente (#500)', () => {
  it('mtFingerprint atual ≠ gravado ⇒ divergente (editado à mão)', () => {
    expect(isDivergente({ ...base(), currentMtFingerprint: 'mt-novo' })).toBe(true)
  })

  it('mtFingerprint gravado NULL ⇒ sempre divergente (legado sem prova de intocabilidade)', () => {
    expect(isDivergente({ ...base(), storedMtFingerprint: null })).toBe(true)
  })

  it('mtFingerprint bate ⇒ NÃO divergente (intocada)', () => {
    expect(isDivergente(base())).toBe(false)
  })
})

describe('isDefasadaEDivergente (#500) — composição AND', () => {
  it('defasada E divergente ⇒ entra na lista do Curador', () => {
    expect(
      isDefasadaEDivergente({
        ...base(),
        currentSourceFingerprint: 'src-novo', // defasada
        currentMtFingerprint: 'mt-novo', // divergente
      }),
    ).toBe(true)
  })

  it('defasada mas INTOCADA (mt bate) ⇒ NÃO entra (é da fatia B, re-tradução automática)', () => {
    expect(isDefasadaEDivergente({ ...base(), currentSourceFingerprint: 'src-novo' })).toBe(false)
  })

  it('divergente mas NÃO defasada (fonte não mudou) ⇒ NÃO entra', () => {
    expect(isDefasadaEDivergente({ ...base(), currentMtFingerprint: 'mt-novo' })).toBe(false)
  })

  it('legado (mt NULL) + fonte mudou ⇒ entra', () => {
    expect(
      isDefasadaEDivergente({
        ...base(),
        currentSourceFingerprint: 'src-novo',
        storedMtFingerprint: null,
      }),
    ).toBe(true)
  })

  it('legado (mt NULL) mas fonte NÃO mudou e versão em dia ⇒ NÃO entra (não é defasada)', () => {
    expect(isDefasadaEDivergente({ ...base(), storedMtFingerprint: null })).toBe(false)
  })

  it('nem defasada nem divergente (tudo bate) ⇒ NÃO entra', () => {
    expect(isDefasadaEDivergente(base())).toBe(false)
  })
})

describe('circuit-breaker da re-tradução (#520)', () => {
  const key = retranslateFailKey('src-atual', V)

  it('a chave muda quando a fonte OU a versão do prompt muda', () => {
    expect(retranslateFailKey('src-novo', V)).not.toBe(key)
    expect(retranslateFailKey('src-atual', V + 1)).not.toBe(key)
    expect(retranslateFailKey('src-atual', V)).toBe(key)
  })

  it('abaixo do limiar ⇒ não está em quarentena', () => {
    expect(
      isRetranslateQuarantined({ failCount: RETRANSLATE_FAIL_THRESHOLD - 1, storedFailKey: key, currentFailKey: key }),
    ).toBe(false)
  })

  it('no limiar, mesma tentativa ⇒ quarentena', () => {
    expect(
      isRetranslateQuarantined({ failCount: RETRANSLATE_FAIL_THRESHOLD, storedFailKey: key, currentFailKey: key }),
    ).toBe(true)
  })

  it('no limiar, mas a fonte/versão mudou desde as falhas ⇒ quarentena cai sozinha', () => {
    expect(
      isRetranslateQuarantined({
        failCount: RETRANSLATE_FAIL_THRESHOLD,
        storedFailKey: key,
        currentFailKey: retranslateFailKey('src-novo', V),
      }),
    ).toBe(false)
  })

  it('sem chave gravada (nunca falhou) ⇒ não está em quarentena', () => {
    expect(isRetranslateQuarantined({ failCount: 0, storedFailKey: null, currentFailKey: key })).toBe(false)
  })
})

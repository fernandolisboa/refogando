import { describe, expect, it } from 'vitest'
import {
  AVISO_LEGAL_CONTAS_ANTES_DE_MS,
  AVISO_LEGAL_VERSAO,
  DATA_PUBLICACAO_TERMOS_V1,
  avisoLegalStorageKey,
  shouldShowLegalNotice,
} from '@/domain/legal-notice'

/** Público e chave do aviso de mudança dos textos legais (ADR-0051). PURO. */
describe('legal-notice', () => {
  it('o corte é a meia-noite de Brasília do dia da publicação', () => {
    expect(new Date(AVISO_LEGAL_CONTAS_ANTES_DE_MS).toISOString()).toBe(`${DATA_PUBLICACAO_TERMOS_V1}T03:00:00.000Z`)
  })

  it('mostra só para conta anterior ao corte, com sessão e sem dispensa', () => {
    const antes = AVISO_LEGAL_CONTAS_ANTES_DE_MS - 1
    expect(shouldShowLegalNotice({ authed: true, createdAt: antes, dismissed: false })).toBe(true)
    expect(shouldShowLegalNotice({ authed: true, createdAt: new Date(antes).toISOString(), dismissed: false })).toBe(
      true,
    )
    expect(shouldShowLegalNotice({ authed: true, createdAt: AVISO_LEGAL_CONTAS_ANTES_DE_MS, dismissed: false })).toBe(
      false,
    )
    expect(shouldShowLegalNotice({ authed: false, createdAt: antes, dismissed: false })).toBe(false)
    expect(shouldShowLegalNotice({ authed: true, createdAt: antes, dismissed: true })).toBe(false)
  })

  it('storage ilegível (dismissed undefined) mostra; createdAt ausente ou inválido não mostra', () => {
    const antes = AVISO_LEGAL_CONTAS_ANTES_DE_MS - 1
    expect(shouldShowLegalNotice({ authed: true, createdAt: antes, dismissed: undefined })).toBe(true)
    expect(shouldShowLegalNotice({ authed: true, createdAt: null, dismissed: false })).toBe(false)
    expect(shouldShowLegalNotice({ authed: true, createdAt: 'não é data', dismissed: false })).toBe(false)
  })

  it('a chave muda com a versão e com a conta', () => {
    expect(avisoLegalStorageKey('u1')).toBe(`refogando:aviso-legal:${AVISO_LEGAL_VERSAO}:u1`)
    expect(avisoLegalStorageKey('u1', 'termos-v2')).not.toBe(avisoLegalStorageKey('u1'))
    expect(avisoLegalStorageKey('u2')).not.toBe(avisoLegalStorageKey('u1'))
  })
})

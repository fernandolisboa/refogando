import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { RESTRICOES_CONSENTIMENTO_VERSAO, consentimentoRestricoesDesatualizado } from '@/domain/restricoes-perfil'

/**
 * #600: o texto de consentimento das restrições salvas (`restricoesPerfil.consentimento`, nos dois idiomas) e a
 * versão gravada com cada consentimento andam juntos. Mudou o texto? Troque `RESTRICOES_CONSENTIMENTO_VERSAO`
 * (a data do texto novo) e acrescente a linha nova aqui, com o hash que o teste mostrar. NUNCA troque o hash de uma
 * versão que já existe: quem consentiu com ela viu aquele texto, e o aviso de mudança depende disso.
 */
const HASH_POR_VERSAO: Record<string, string> = {
  '2026-10-22': '1a890784c17f4dca123a12a405d285801cbf51b35a4700e6b0f2ca9f7ab1f761',
}

function hashDoTexto(): string {
  return createHash('sha256')
    .update(`${ptBR.restricoesPerfil.consentimento}\n${enUS.restricoesPerfil.consentimento}`)
    .digest('hex')
}

describe('versão do consentimento das restrições salvas (#600)', () => {
  it('o texto atual é o da versão atual (mudar o texto pede versão nova)', () => {
    expect(hashDoTexto()).toBe(HASH_POR_VERSAO[RESTRICOES_CONSENTIMENTO_VERSAO])
  })

  it('a versão é uma data AAAA-MM-DD', () => {
    expect(RESTRICOES_CONSENTIMENTO_VERSAO).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('aviso de mudança: só com restrições salvas e versão diferente da atual (ou sem versão)', () => {
    expect(consentimentoRestricoesDesatualizado({ temSalvas: true, versao: null })).toBe(true)
    expect(consentimentoRestricoesDesatualizado({ temSalvas: true, versao: '2026-07-03' })).toBe(true)
    expect(consentimentoRestricoesDesatualizado({ temSalvas: true, versao: RESTRICOES_CONSENTIMENTO_VERSAO })).toBe(false)
    expect(consentimentoRestricoesDesatualizado({ temSalvas: false, versao: null })).toBe(false)
  })
})

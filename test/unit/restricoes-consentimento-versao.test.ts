import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { RESTRICOES_CONSENTIMENTO_VERSAO, consentimentoRestricoesDesatualizado } from '@/domain/restricoes-perfil'

/**
 * #600: o texto de consentimento das restrições salvas (`restricoesPerfil.consentimento`, nos dois idiomas), a
 * versão gravada com cada consentimento e o registro dos textos (`docs/legal/consentimento-restricoes.md`) andam
 * juntos. Mudou o texto? Troque `RESTRICOES_CONSENTIMENTO_VERSAO` (a data do texto novo), acrescente a seção no
 * registro e a linha aqui, com o hash que o teste mostrar. NUNCA troque o hash de uma versão que já existe: quem
 * consentiu com ela viu aquele texto, e o aviso de mudança depende disso.
 */
const HASH_POR_VERSAO: Record<string, string> = {
  '2026-10-22': '1a890784c17f4dca123a12a405d285801cbf51b35a4700e6b0f2ca9f7ab1f761',
}

function hash(pt: string, en: string): string {
  return createHash('sha256').update(`${pt}\n${en}`).digest('hex')
}

/** Seções `## <versão>` do registro, com as linhas `- pt-BR: …` e `- en-US: …`. */
function registro(): Map<string, { pt: string; en: string }> {
  const doc = readFileSync(new URL('../../docs/legal/consentimento-restricoes.md', import.meta.url), 'utf8')
  const out = new Map<string, { pt: string; en: string }>()
  for (const secao of doc.split(/^## /m).slice(1)) {
    const versao = secao.slice(0, secao.indexOf('\n')).trim()
    const pt = /^- pt-BR: (.+)$/m.exec(secao)?.[1] ?? ''
    const en = /^- en-US: (.+)$/m.exec(secao)?.[1] ?? ''
    out.set(versao, { pt, en })
  }
  return out
}

describe('versão do consentimento das restrições salvas (#600)', () => {
  it('o texto atual é o da versão atual (mudar o texto pede versão nova)', () => {
    expect(hash(ptBR.restricoesPerfil.consentimento, enUS.restricoesPerfil.consentimento)).toBe(
      HASH_POR_VERSAO[RESTRICOES_CONSENTIMENTO_VERSAO],
    )
  })

  it('o registro tem cada versão, com o texto daquela versão (nenhuma seção editada depois)', () => {
    const r = registro()
    expect([...r.keys()].sort()).toEqual(Object.keys(HASH_POR_VERSAO).sort())
    for (const [versao, { pt, en }] of r) expect(hash(pt, en), versao).toBe(HASH_POR_VERSAO[versao])
    expect(r.get(RESTRICOES_CONSENTIMENTO_VERSAO)).toEqual({
      pt: ptBR.restricoesPerfil.consentimento,
      en: enUS.restricoesPerfil.consentimento,
    })
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

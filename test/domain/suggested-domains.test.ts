import { describe, it, expect } from 'vitest'
import {
  SUGGESTED_DOMAINS,
  addDomainToAllowlistText,
  isSuggestionPresent,
} from '@/domain/suggested-domains'
import { canonicalizeDomain } from '@/domain/web-search-config'

/**
 * Domínios sugeridos (#273) — listas curadas + helpers PUROS de click-to-add. Clicar só ACRESCENTA ao
 * texto da allowlist (estado local), com dedup CANONICALIZADO e null-safe (linha-lixo não casa nem
 * quebra). NÃO salva nem ativa — sugerir ≠ vetar. Sem rede, sem DB.
 */

describe('SUGGESTED_DOMAINS', () => {
  it('tem os grupos pt-BR e en-US com as entradas curadas', () => {
    expect(SUGGESTED_DOMAINS['pt-BR']).toContain('tudogostoso.com.br')
    expect(SUGGESTED_DOMAINS['pt-BR']).toContain('panelinha.com.br')
    expect(SUGGESTED_DOMAINS['pt-BR']).toContain('receitasnestle.com.br')
    expect(SUGGESTED_DOMAINS['en-US']).toContain('allrecipes.com')
    expect(SUGGESTED_DOMAINS['en-US']).toContain('bbcgoodfood.com')
  })

  it('todas as entradas já são CANÔNICAS (canonicalizeDomain(d) === d)', () => {
    for (const d of [...SUGGESTED_DOMAINS['pt-BR'], ...SUGGESTED_DOMAINS['en-US']]) {
      expect(canonicalizeDomain(d)).toBe(d)
    }
  })
})

describe('addDomainToAllowlistText', () => {
  it('acrescenta a um texto vazio (sem newline líder)', () => {
    expect(addDomainToAllowlistText('', 'tudogostoso.com.br')).toBe('tudogostoso.com.br')
  })

  it('acrescenta numa nova linha preservando o conteúdo existente', () => {
    expect(addDomainToAllowlistText('panelinha.com.br', 'tudogostoso.com.br')).toBe(
      'panelinha.com.br\ntudogostoso.com.br',
    )
  })

  it('não duplica a newline quando o texto já termina em quebra', () => {
    expect(addDomainToAllowlistText('panelinha.com.br\n', 'tudogostoso.com.br')).toBe(
      'panelinha.com.br\ntudogostoso.com.br',
    )
  })

  it('é no-op quando o domínio já está presente (dedup canônico: www./maiúsculas/ponto-final)', () => {
    expect(addDomainToAllowlistText('tudogostoso.com.br', 'tudogostoso.com.br')).toBe(
      'tudogostoso.com.br',
    )
    expect(addDomainToAllowlistText('WWW.TudoGostoso.com.br', 'tudogostoso.com.br')).toBe(
      'WWW.TudoGostoso.com.br',
    )
    expect(addDomainToAllowlistText('tudogostoso.com.br.', 'tudogostoso.com.br')).toBe(
      'tudogostoso.com.br.',
    )
  })

  it('null-safe: linha-lixo presente não quebra nem casa — o clique ainda acrescenta', () => {
    expect(addDomainToAllowlistText('isto não é um domínio', 'tudogostoso.com.br')).toBe(
      'isto não é um domínio\ntudogostoso.com.br',
    )
  })
})

describe('isSuggestionPresent', () => {
  it('true quando o domínio (canônico) já está numa linha', () => {
    expect(isSuggestionPresent('tudogostoso.com.br', 'tudogostoso.com.br')).toBe(true)
    expect(isSuggestionPresent('WWW.TudoGostoso.com.br\npanelinha.com.br', 'tudogostoso.com.br')).toBe(
      true,
    )
  })

  it('false quando ausente, e ignora linhas-lixo', () => {
    expect(isSuggestionPresent('panelinha.com.br', 'tudogostoso.com.br')).toBe(false)
    expect(isSuggestionPresent('isto não é um domínio', 'tudogostoso.com.br')).toBe(false)
    expect(isSuggestionPresent('', 'tudogostoso.com.br')).toBe(false)
  })
})

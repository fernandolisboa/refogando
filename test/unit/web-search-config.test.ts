import { describe, expect, it } from 'vitest'
import {
  canonicalizeDomain,
  parseAllowlist,
  parseWebSearchConfig,
  isUrlAllowed,
  DEFAULT_WEB_SEARCH_CONFIG,
} from '@/domain/web-search-config'

/**
 * Config da DESCOBERTA na web (#164, ADR-0019) — PURO. `canonicalizeDomain`/`parseAllowlist` validam a
 * curadoria de domínios; `parseWebSearchConfig` valida o PUT do admin; `isUrlAllowed` é o GUARD de SSRF
 * compartilhado pelo endpoint e pelo import. Espelha `image-gen-config.test.ts`.
 */

describe('canonicalizeDomain', () => {
  it('minúsculo + tira www. + ponto final', () => {
    expect(canonicalizeDomain('WWW.TudoGostoso.com.br')).toBe('tudogostoso.com.br')
    expect(canonicalizeDomain('panelinha.com.br.')).toBe('panelinha.com.br')
    expect(canonicalizeDomain('  exemplo.com  ')).toBe('exemplo.com')
  })

  it('recusa entradas que não são hostname plausível', () => {
    expect(canonicalizeDomain('')).toBeNull()
    expect(canonicalizeDomain('localhost')).toBeNull() // sem ponto
    expect(canonicalizeDomain('com')).toBeNull() // TLD solto
    expect(canonicalizeDomain('https://exemplo.com')).toBeNull() // esquema
    expect(canonicalizeDomain('exemplo.com/path')).toBeNull() // caminho
    expect(canonicalizeDomain('exemplo.com:8080')).toBeNull() // porta
    expect(canonicalizeDomain('a b.com')).toBeNull() // espaço
    expect(canonicalizeDomain('*.exemplo.com')).toBeNull() // wildcard cru
    expect(canonicalizeDomain('user@exemplo.com')).toBeNull() // arroba
    expect(canonicalizeDomain(42)).toBeNull() // não-string
  })
})

describe('parseAllowlist', () => {
  it('canonicaliza, dedup preservando ordem', () => {
    expect(parseAllowlist(['WWW.A.com', 'b.com', 'a.com'])).toEqual(['a.com', 'b.com'])
  })

  it('lista vazia → []', () => {
    expect(parseAllowlist([])).toEqual([])
  })

  it('qualquer item inválido ⇒ rejeita o lote inteiro (null)', () => {
    expect(parseAllowlist(['a.com', 'localhost'])).toBeNull()
    expect(parseAllowlist('a.com')).toBeNull() // não-array
  })

  it('acima do teto ⇒ null', () => {
    const big = Array.from({ length: 51 }, (_, i) => `d${i}.com`)
    expect(parseAllowlist(big)).toBeNull()
  })
})

describe('parseWebSearchConfig', () => {
  it('válido: enabled boolean + allowlist canonicalizada', () => {
    const r = parseWebSearchConfig({ enabled: true, allowlist: ['WWW.A.com'] })
    expect(r).toEqual({ ok: true, value: { enabled: true, allowlist: ['a.com'] } })
  })

  it('enabled não-boolean ⇒ ok:false', () => {
    expect(parseWebSearchConfig({ enabled: 'sim', allowlist: [] })).toEqual({ ok: false })
  })

  it('allowlist inválida ⇒ ok:false', () => {
    expect(parseWebSearchConfig({ enabled: true, allowlist: ['localhost'] })).toEqual({ ok: false })
  })

  it('não-objeto / array ⇒ ok:false', () => {
    expect(parseWebSearchConfig(null)).toEqual({ ok: false })
    expect(parseWebSearchConfig([])).toEqual({ ok: false })
  })
})

describe('isUrlAllowed — guard de SSRF + allowlist', () => {
  const allow = ['tudogostoso.com.br', 'panelinha.com.br']

  it('host listado ou subdomínio ⇒ true', () => {
    expect(isUrlAllowed('https://tudogostoso.com.br/r/1', allow)).toBe(true)
    expect(isUrlAllowed('https://m.tudogostoso.com.br/r/1', allow)).toBe(true)
    expect(isUrlAllowed('http://www.panelinha.com.br/x', allow)).toBe(true)
  })

  it('host fora da allowlist ⇒ false (inclui look-alike)', () => {
    expect(isUrlAllowed('https://evil.test/r', allow)).toBe(false)
    // boundary de rótulo: evil-tudogostoso NÃO casa tudogostoso.com.br
    expect(isUrlAllowed('https://evil-tudogostoso.com.br/r', allow)).toBe(false)
  })

  it('esquema não-http(s) ⇒ false (file:/javascript:/data:)', () => {
    expect(isUrlAllowed('javascript:alert(1)', allow)).toBe(false)
    expect(isUrlAllowed('file:///etc/passwd', allow)).toBe(false)
    expect(isUrlAllowed('data:text/html,x', allow)).toBe(false)
  })

  it('allowlist vazia ⇒ false (fail-closed) mesmo para URL bem-formada', () => {
    expect(isUrlAllowed('https://tudogostoso.com.br/r', [])).toBe(false)
  })

  it('URL malformada ⇒ false', () => {
    expect(isUrlAllowed('não é url', allow)).toBe(false)
  })
})

describe('defaults', () => {
  it('descoberta na web nasce DESLIGADA e allowlist vazia (fail-closed)', () => {
    expect(DEFAULT_WEB_SEARCH_CONFIG).toEqual({ enabled: false, allowlist: [] })
  })
})

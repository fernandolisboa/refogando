import { describe, expect, it } from 'vitest'
import {
  canonicalizeDomain,
  parseAllowlist,
  parseWebSearchConfig,
  isUrlAllowed,
  deniedDomainsIn,
  TOS_DENYLIST,
  DEFAULT_WEB_SEARCH_CONFIG,
  isWebSearchOpen,
} from '@/domain/web-search-config'

/**
 * Config da DESCOBERTA na web (#164, ADR-0019) — PURO. `canonicalizeDomain`/`parseAllowlist` validam a
 * curadoria de domínios; `parseWebSearchConfig` valida o PUT do admin; `isUrlAllowed` é o GUARD de SSRF
 * compartilhado pelo endpoint e pelo import. Espelha `image-gen-config.test.ts`.
 */

describe('canonicalizeDomain', () => {
  it('minúsculo + tira www. + ponto final', () => {
    expect(canonicalizeDomain('WWW.TudoGostoso.com.br')).toBe('tudogostoso.com.br')
    expect(canonicalizeDomain('tudogostoso.com.br.')).toBe('tudogostoso.com.br')
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

describe('TOS_DENYLIST — guard de domínios vetados por ToS (#394)', () => {
  it('a const lista os 3 hosts vetados, em forma canônica', () => {
    expect([...TOS_DENYLIST]).toEqual(
      expect.arrayContaining(['panelinha.com.br', 'guiadacozinha.com.br', 'foodnetwork.com']),
    )
    // Cada entrada já é canônica por si (sem www., minúsculo, hostname válido) — mas NÃO passa por
    // canonicalizeDomain (que a rejeita de propósito). Garante que ninguém digitou lixo na const.
    for (const d of TOS_DENYLIST) {
      expect(d).toBe(d.trim().toLowerCase())
      expect(d.startsWith('www.')).toBe(false)
      expect(d.includes('.')).toBe(true)
    }
  })

  it('canonicalizeDomain rejeita o host EXATO vetado (e variações www./maiúscula/ponto)', () => {
    expect(canonicalizeDomain('panelinha.com.br')).toBeNull()
    expect(canonicalizeDomain('WWW.Panelinha.com.br')).toBeNull()
    expect(canonicalizeDomain('foodnetwork.com.')).toBeNull()
    expect(canonicalizeDomain('guiadacozinha.com.br')).toBeNull()
  })

  it('canonicalizeDomain rejeita SUBDOMÍNIOS dos hosts vetados', () => {
    expect(canonicalizeDomain('m.panelinha.com.br')).toBeNull()
    expect(canonicalizeDomain('blog.foodnetwork.com')).toBeNull()
    expect(canonicalizeDomain('www.receitas.guiadacozinha.com.br')).toBeNull()
  })

  it('NÃO rejeita look-alikes que só compartilham sufixo (boundary de rótulo)', () => {
    // `evil-panelinha.com.br` NÃO é subdomínio de `panelinha.com.br` — o ponto delimita o rótulo.
    expect(canonicalizeDomain('evil-panelinha.com.br')).toBe('evil-panelinha.com.br')
    expect(canonicalizeDomain('notfoodnetwork.com')).toBe('notfoodnetwork.com')
  })

  it('parseAllowlist: um vetado no lote ⇒ rejeita o LOTE inteiro (null), como qualquer inválido', () => {
    expect(parseAllowlist(['tudogostoso.com.br', 'panelinha.com.br'])).toBeNull()
    expect(parseAllowlist(['a.com', 'm.foodnetwork.com', 'b.com'])).toBeNull()
    // lote 100% limpo continua passando
    expect(parseAllowlist(['tudogostoso.com.br', 'cybercook.com.br'])).toEqual([
      'tudogostoso.com.br',
      'cybercook.com.br',
    ])
  })

  it('parseWebSearchConfig rejeita a config quando a allowlist inclui um vetado', () => {
    expect(
      parseWebSearchConfig({ enabled: true, allowlist: ['guiadacozinha.com.br'] }),
    ).toEqual({ ok: false })
  })

  it('deniedDomainsIn reporta os hosts vetados do PUT cru (host exato + subdomínio, dedup canônico)', () => {
    expect(
      deniedDomainsIn({ enabled: true, allowlist: ['tudogostoso.com.br', 'WWW.Panelinha.com.br'] }),
    ).toEqual(['panelinha.com.br'])
    // reporta cada host ofensor como digitado (normalizado) — inclusive subdomínio distinto do root
    expect(deniedDomainsIn({ enabled: true, allowlist: ['m.foodnetwork.com', 'foodnetwork.com'] })).toEqual([
      'm.foodnetwork.com',
      'foodnetwork.com',
    ])
    // aceita também um array cru; nenhum vetado ⇒ vazio
    expect(deniedDomainsIn(['tudogostoso.com.br', 'cybercook.com.br'])).toEqual([])
    // entradas não-array / lixo ⇒ vazio (não estoura)
    expect(deniedDomainsIn({ enabled: true, allowlist: 'x' })).toEqual([])
    expect(deniedDomainsIn(null)).toEqual([])
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

describe('isWebSearchOpen', () => {
  it('só libera com a flag ligada E ao menos um domínio (fail-closed)', () => {
    expect(isWebSearchOpen(DEFAULT_WEB_SEARCH_CONFIG)).toBe(false)
    expect(isWebSearchOpen({ enabled: true, allowlist: [] })).toBe(false)
    expect(isWebSearchOpen({ enabled: false, allowlist: ['tudogostoso.com.br'] })).toBe(false)
    expect(isWebSearchOpen({ enabled: true, allowlist: ['tudogostoso.com.br'] })).toBe(true)
  })
})

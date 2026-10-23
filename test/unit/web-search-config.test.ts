import { describe, expect, it } from 'vitest'
import {
  canonicalizeDomain,
  parseAllowlist,
  parseStoredAllowlist,
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
  it('a const lista os 9 hosts vetados (3 de #394 + 6 do parecer de 2026-10-22), em forma canônica', () => {
    expect([...TOS_DENYLIST].sort()).toEqual(
      [
        'panelinha.com.br',
        'guiadacozinha.com.br',
        'foodnetwork.com',
        'cybercook.com.br',
        'receiteria.com.br',
        'allrecipes.com',
        'simplyrecipes.com',
        'seriouseats.com',
        'bbcgoodfood.com',
      ].sort(),
    )
    // Os dois mantidos no parecer NÃO são vetados.
    expect(TOS_DENYLIST).not.toContain('tudogostoso.com.br')
    expect(TOS_DENYLIST).not.toContain('receitasnestle.com.br')
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

  it('canonicalizeDomain rejeita os 6 vetados no parecer de 2026-10-22 (com www./maiúscula)', () => {
    for (const d of [
      'cybercook.com.br',
      'WWW.Receiteria.com.br',
      'www.allrecipes.com',
      'simplyrecipes.com.',
      'seriouseats.com',
      'www.bbcgoodfood.com',
    ]) {
      expect(canonicalizeDomain(d), d).toBeNull()
    }
    expect(canonicalizeDomain('tudogostoso.com.br')).toBe('tudogostoso.com.br')
    expect(canonicalizeDomain('www.receitasnestle.com.br')).toBe('receitasnestle.com.br')
  })

  it('canonicalizeDomain rejeita SUBDOMÍNIOS dos hosts vetados', () => {
    expect(canonicalizeDomain('m.panelinha.com.br')).toBeNull()
    expect(canonicalizeDomain('blog.foodnetwork.com')).toBeNull()
    expect(canonicalizeDomain('www.receitas.guiadacozinha.com.br')).toBeNull()
    expect(canonicalizeDomain('m.allrecipes.com')).toBeNull()
  })

  it('NÃO rejeita look-alikes que só compartilham sufixo (boundary de rótulo)', () => {
    // `evil-panelinha.com.br` NÃO é subdomínio de `panelinha.com.br` — o ponto delimita o rótulo.
    expect(canonicalizeDomain('evil-panelinha.com.br')).toBe('evil-panelinha.com.br')
    expect(canonicalizeDomain('notfoodnetwork.com')).toBe('notfoodnetwork.com')
  })

  it('parseAllowlist: um vetado no lote ⇒ rejeita o LOTE inteiro (null), como qualquer inválido', () => {
    expect(parseAllowlist(['tudogostoso.com.br', 'panelinha.com.br'])).toBeNull()
    expect(parseAllowlist(['a.com', 'm.foodnetwork.com', 'b.com'])).toBeNull()
    expect(parseAllowlist(['tudogostoso.com.br', 'allrecipes.com'])).toBeNull()
    // lote 100% limpo continua passando
    expect(parseAllowlist(['tudogostoso.com.br', 'receitasnestle.com.br'])).toEqual([
      'tudogostoso.com.br',
      'receitasnestle.com.br',
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
    expect(deniedDomainsIn(['tudogostoso.com.br', 'receitasnestle.com.br'])).toEqual([])
    expect(deniedDomainsIn(['tudogostoso.com.br', 'www.bbcgoodfood.com'])).toEqual(['bbcgoodfood.com'])
    // entradas não-array / lixo ⇒ vazio (não estoura)
    expect(deniedDomainsIn({ enabled: true, allowlist: 'x' })).toEqual([])
    expect(deniedDomainsIn(null)).toEqual([])
  })
})

describe('parseStoredAllowlist — leitura da allowlist já gravada no banco', () => {
  it('descarta SÓ os domínios vetados (host exato ou subdomínio) e mantém os demais', () => {
    // Linha gravada antes do parecer de 2026-10-22, com domínios que viraram denylist depois.
    expect(
      parseStoredAllowlist([
        'tudogostoso.com.br',
        'cybercook.com.br',
        'www.allrecipes.com',
        'm.panelinha.com.br',
        'receitasnestle.com.br',
        'bbcgoodfood.com',
      ]),
    ).toEqual(['tudogostoso.com.br', 'receitasnestle.com.br'])
  })

  it('allowlist só com vetados ⇒ [] (fail-closed: a Descoberta fica sem domínio)', () => {
    expect(parseStoredAllowlist(['seriouseats.com', 'simplyrecipes.com'])).toEqual([])
  })

  it('canonicaliza e deduplica como o PUT; look-alike de vetado NÃO é descartado', () => {
    expect(parseStoredAllowlist(['WWW.TudoGostoso.com.br', 'tudogostoso.com.br.'])).toEqual([
      'tudogostoso.com.br',
    ])
    expect(parseStoredAllowlist(['notallrecipes.com'])).toEqual(['notallrecipes.com'])
  })

  it('lixo continua rejeitando o lote inteiro (null), como antes', () => {
    expect(parseStoredAllowlist(['tudogostoso.com.br', 'localhost'])).toBeNull()
    expect(parseStoredAllowlist('tudogostoso.com.br')).toBeNull()
    expect(parseStoredAllowlist(null)).toBeNull()
    expect(parseStoredAllowlist(Array.from({ length: 51 }, (_, i) => `d${i}.com`))).toBeNull()
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
  const allow = ['tudogostoso.com.br', 'receitasnestle.com.br']

  it('host listado ou subdomínio ⇒ true', () => {
    expect(isUrlAllowed('https://tudogostoso.com.br/r/1', allow)).toBe(true)
    expect(isUrlAllowed('https://m.tudogostoso.com.br/r/1', allow)).toBe(true)
    expect(isUrlAllowed('http://www.receitasnestle.com.br/x', allow)).toBe(true)
  })

  it('host vetado por ToS ⇒ false por conta própria, mesmo coberto por um sufixo pai na allowlist', () => {
    // Uma linha gravada com `com.br` (ou `com`) cobriria qualquer host abaixo dela: a denylist barra sozinha.
    expect(isUrlAllowed('https://panelinha.com.br/receita/1', ['com.br'])).toBe(false)
    expect(isUrlAllowed('https://www.cybercook.com.br/receita/2', ['com.br'])).toBe(false)
    expect(isUrlAllowed('https://m.allrecipes.com/recipe/3', ['com'])).toBe(false)
    // Host vetado listado de novo, cru (chamador que não passou por `parseStoredAllowlist`): também recusa.
    expect(isUrlAllowed('https://receiteria.com.br/x', ['receiteria.com.br'])).toBe(false)
    // O resto do sufixo segue liberado; look-alike de vetado não é vetado.
    expect(isUrlAllowed('https://tudogostoso.com.br/r/1', ['com.br'])).toBe(true)
    expect(isUrlAllowed('https://notallrecipes.com/r', ['com'])).toBe(true)
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

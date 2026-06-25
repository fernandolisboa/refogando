import { describe, it, expect } from 'vitest'
import { isPathAllowedByRobots } from '@/domain/robots-txt'

/**
 * Avaliador PURO de robots.txt (#272, ADR-0019 emenda legal) — RFC 9309. Decide se o nosso importador
 * (product token `RefogandoBot`) pode buscar um `path` (pathname+search) dado o corpo de um robots.txt.
 * SEM rede, SEM I/O — o fetch do robots.txt vive no seam server-side (`RealRecipeImporter`). A confiança
 * da política mora AQUI: o seam é fail-open (robots indisponível ⇒ permitido), então o parser precisa
 * acertar o caso em que o robots.txt EXISTE e proíbe.
 */

const UA = 'RefogandoBot'

describe('isPathAllowedByRobots — seleção de grupo (RFC 9309 §2.2.1)', () => {
  it('o grupo do nosso token VENCE o grupo "*" quando ambos existem (não herda o "*")', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: RefogandoBot', 'Disallow: /privado'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/receitas/bolo')).toBe(true)
    expect(isPathAllowedByRobots(txt, UA, '/privado/x')).toBe(false)
  })

  it('cai no grupo "*" quando NÃO há grupo para o nosso token', () => {
    const txt = ['User-agent: *', 'Disallow: /admin'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/admin/x')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/receitas')).toBe(true)
  })

  it('múltiplos User-agent CONSECUTIVOS compartilham o MESMO bloco de regras', () => {
    const txt = ['User-agent: SomeBot', 'User-agent: RefogandoBot', 'Disallow: /naoentre'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/naoentre/x')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/ok')).toBe(true)
  })

  it('regras NÃO vazam entre grupos: um bloco RefogandoBot após um bloco "*" não herda as regras do "*"', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: RefogandoBot', 'Allow: /'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/qualquer')).toBe(true)
  })

  it('User-agent casa CASE-INSENSITIVE (refogandobot ~ RefogandoBot)', () => {
    const txt = ['User-agent: refogandobot', 'Disallow: /x'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/x/y')).toBe(false)
  })
})

describe('isPathAllowedByRobots — longest-match e desempate (RFC 9309 §2.2.2)', () => {
  it('Allow mais LONGO vence Disallow mais curto → permitido', () => {
    const txt = ['User-agent: *', 'Disallow: /a', 'Allow: /a/b'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/a/b/c')).toBe(true)
  })

  it('Disallow mais LONGO vence Allow mais curto → bloqueado', () => {
    const txt = ['User-agent: *', 'Allow: /a', 'Disallow: /a/secret'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/a/secret/x')).toBe(false)
  })

  it('EMPATE de comprimento de padrão → Allow vence', () => {
    const txt = ['User-agent: *', 'Disallow: /p', 'Allow: /p'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/p')).toBe(true)
  })

  it('a especificidade é o comprimento do PADRÃO, não do trecho casado (* conta 1 char)', () => {
    // Allow:/ab (len 4) e Disallow:/a* (len 3) ambos casam /abc → Allow mais longo vence
    const txt = ['User-agent: *', 'Disallow: /a*', 'Allow: /ab'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/abc')).toBe(true)
  })
})

describe('isPathAllowedByRobots — wildcards e âncora $', () => {
  it('wildcard "*" no meio: Disallow:/*/secret bloqueia /x/secret e /y/z/secret, não /secret', () => {
    const txt = ['User-agent: *', 'Disallow: /*/secret'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/x/secret')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/y/z/secret')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/secret')).toBe(true)
  })

  it('âncora "$": Disallow:/*.json$ bloqueia /a.json mas PERMITE /a.json?x=1 (path = pathname+search)', () => {
    const txt = ['User-agent: *', 'Disallow: /*.json$'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/a.json')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/a.json?x=1')).toBe(true)
  })

  it('Allow:/$ + Disallow:/ → raiz permitida, resto bloqueado (/$ len 2 > / len 1)', () => {
    const txt = ['User-agent: *', 'Allow: /$', 'Disallow: /'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/')).toBe(true)
    expect(isPathAllowedByRobots(txt, UA, '/page.htm')).toBe(false)
  })
})

describe('isPathAllowedByRobots — case-sensitivity, vazios e robustez', () => {
  it('o path é CASE-SENSITIVE: Disallow:/Private NÃO bloqueia /private', () => {
    const txt = ['User-agent: *', 'Disallow: /Private'].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/private')).toBe(true)
    expect(isPathAllowedByRobots(txt, UA, '/Private')).toBe(false)
  })

  it('Disallow:/ bloqueia tudo; Disallow vazio (sem valor) permite tudo', () => {
    expect(isPathAllowedByRobots('User-agent: *\nDisallow: /', UA, '/qualquer')).toBe(false)
    expect(isPathAllowedByRobots('User-agent: *\nDisallow:', UA, '/qualquer')).toBe(true)
  })

  it('arquivo vazio / só comentários / grupo sem regras → permitido', () => {
    expect(isPathAllowedByRobots('', UA, '/x')).toBe(true)
    expect(isPathAllowedByRobots('# só um comentário\n# outro', UA, '/x')).toBe(true)
    expect(isPathAllowedByRobots('User-agent: *', UA, '/x')).toBe(true)
  })

  it('comentários inline, diretivas desconhecidas e linhas malformadas são ignoradas', () => {
    const txt = [
      'Sitemap: https://x/sitemap.xml',
      'Crawl-delay: 10',
      'User-agent: * # todos',
      'Disallow: /admin # área interna',
      'linha-sem-dois-pontos',
    ].join('\n')
    expect(isPathAllowedByRobots(txt, UA, '/admin/x')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/ok')).toBe(true)
  })

  it('normaliza CRLF e BOM; os nomes de diretiva são case-insensitive', () => {
    const txt = '﻿User-Agent: *\r\nDISALLOW: /x\r\n'
    expect(isPathAllowedByRobots(txt, UA, '/x/y')).toBe(false)
    expect(isPathAllowedByRobots(txt, UA, '/ok')).toBe(true)
  })

  it('path vazio é tratado como "/"', () => {
    expect(isPathAllowedByRobots('User-agent: *\nDisallow: /', UA, '')).toBe(false)
  })
})

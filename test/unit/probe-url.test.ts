import { describe, it, expect } from 'vitest'
import { parseProbeUrl, isBlockedAddress } from '@/server/import/probe-url'

/**
 * Barreira de SSRF do probe (#273) — `parseProbeUrl` (validação + normalização) e `isBlockedAddress`
 * (CIDR sobre bytes canônicos). Trava: só http(s); IP privado/loopback/link-local rejeitado por VALOR
 * (não string-match), inclusive decimal/octal/hex (que `new URL` normaliza p/ dotted) e IPv4-mapped.
 */

describe('parseProbeUrl — aceita públicos http(s)', () => {
  it('devolve a URL normalizada para hosts públicos', () => {
    expect(parseProbeUrl('https://tudogostoso.com.br/receita/bolo')).toBe(
      'https://tudogostoso.com.br/receita/bolo',
    )
    expect(parseProbeUrl('http://allrecipes.com/cake')).toBe('http://allrecipes.com/cake')
    expect(parseProbeUrl('  https://example.com/x  ')).toBe('https://example.com/x')
  })
})

describe('parseProbeUrl — rejeita esquemas e lixo', () => {
  it.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,x',
    'not a url',
    '',
    '   ',
  ])('rejeita %s', (raw) => {
    expect(parseProbeUrl(raw)).toBeNull()
  })

  it('rejeita não-string', () => {
    expect(parseProbeUrl(undefined)).toBeNull()
    expect(parseProbeUrl(123)).toBeNull()
    expect(parseProbeUrl(null)).toBeNull()
  })
})

describe('parseProbeUrl — rejeita IP privado/loopback/link-local e hostnames internos', () => {
  it.each([
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://172.16.0.1/x',
    'http://172.31.255.255/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data', // metadata endpoint clássico
    'http://100.64.0.1/x', // CGNAT
    'http://0.0.0.0/x',
    'http://[::1]/x',
    'http://[::ffff:127.0.0.1]/x', // IPv4-mapped (fura string-match → pega por bytes)
    'http://[64:ff9b::169.254.169.254]/latest/meta-data', // NAT64 (RFC 6052) do metadata endpoint
    'http://[64:ff9b::7f00:1]/x', // NAT64 de 127.0.0.1 na forma hex
    'http://[fe80::1]/x',
    'http://[fc00::1]/x',
    'http://localhost/x',
    'http://localhost./x', // ponto final fura string-match cru
    'http://api.localhost/x',
    'http://printer.local/x',
    'http://db.internal/x',
  ])('rejeita %s', (raw) => {
    expect(parseProbeUrl(raw)).toBeNull()
  })

  it.each([
    'http://2130706433/x', // 127.0.0.1 decimal
    'http://0x7f000001/x', // 127.0.0.1 hex
    'http://017700000001/x', // 127.0.0.1 octal
  ])('normalização do new URL + CIDR pega %s', (raw) => {
    expect(parseProbeUrl(raw)).toBeNull()
  })
})

describe('parseProbeUrl — zera userinfo (não vaza Authorization Basic ao host arbitrário)', () => {
  it('remove user:pass embutidos, preservando host e path', () => {
    expect(parseProbeUrl('https://admin:secret@example.com/receita')).toBe(
      'https://example.com/receita',
    )
  })

  it('remove userinfo só com usuário (sem senha)', () => {
    expect(parseProbeUrl('https://user@example.com/x')).toBe('https://example.com/x')
  })

  it('URL pública sem userinfo segue intacta', () => {
    expect(parseProbeUrl('https://example.com/x?q=1')).toBe('https://example.com/x?q=1')
  })
})

describe('isBlockedAddress', () => {
  it('público ⇒ false', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false)
    expect(isBlockedAddress('203.0.113.5')).toBe(false)
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('privado/loopback/link-local ⇒ true', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true)
    expect(isBlockedAddress('10.1.2.3')).toBe(true)
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
    expect(isBlockedAddress('172.20.0.1')).toBe(true)
    expect(isBlockedAddress('192.168.0.1')).toBe(true)
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isBlockedAddress('64:ff9b::169.254.169.254')).toBe(true) // NAT64 do metadata (RFC 6052)
    expect(isBlockedAddress('64:ff9b::a00:1')).toBe(true) // NAT64 de 10.0.0.1
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('fc00::1')).toBe(true)
  })

  it('não-IP ⇒ true (defensivo)', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
  })
})

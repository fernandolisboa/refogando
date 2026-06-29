import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '@/domain/safe-redirect'

describe('safeInternalPath — guarda anti open-redirect (#308)', () => {
  it('passa caminhos internos relativos', () => {
    expect(safeInternalPath('/cooks')).toBe('/cooks')
    expect(safeInternalPath('/pt-BR/cooks')).toBe('/pt-BR/cooks')
    expect(safeInternalPath('/u/ana?x=1#y')).toBe('/u/ana?x=1#y')
  })

  it.each([
    ['vazio/nullish', undefined],
    ['protocol-relative', '//evil.com'],
    ['absoluto http', 'http://evil.com'],
    ['esquema javascript', 'javascript:alert(1)'],
    ['não começa com /', 'cooks'],
    ['backslash', '/\\evil.com'],
    ['control char', `/co${String.fromCharCode(10)}oks`],
    ['gigante', '/' + 'a'.repeat(600)],
  ])('rejeita %s → "/"', (_label, raw) => {
    expect(safeInternalPath(raw as string | undefined)).toBe('/')
  })
})

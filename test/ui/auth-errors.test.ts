import { describe, it, expect } from 'vitest'
import { mapAuthError, parseResetToken } from '@/components/auth/auth-errors'

describe('mapAuthError (#55, #469, #470)', () => {
  it.each([
    [{ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }, 'erroCredencialInvalida'],
    [{ code: 'EMAIL_NOT_VERIFIED', status: 403 }, 'erroEmailNaoVerificado'],
    [{ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 }, 'erroEmailEmUso'],
    [{ code: 'USER_ALREADY_EXISTS', status: 422 }, 'erroEmailEmUso'],
    [{ code: 'PASSWORD_TOO_SHORT', status: 400 }, 'erroSenhaCurta'],
    [{ code: 'INVALID_TOKEN', status: 400 }, 'erroLinkInvalido'],
    [{ status: 429 }, 'erroMuitasTentativas'],
    [{ code: 'QUALQUER', status: 400 }, 'erroGenerico'],
    [{ status: 500 }, 'erroGenerico'],
    [{}, 'erroRede'],
  ] as const)('%j → %s', (error, key) => {
    expect(mapAuthError(error)).toBe(key)
  })
})

describe('parseResetToken (#469)', () => {
  it('token válido passa', () => {
    expect(parseResetToken({ token: 'abc' })).toBe('abc')
  })
  it.each([
    [{}],
    [{ token: '' }],
    [{ token: ['a', 'b'] }],
    [{ error: 'INVALID_TOKEN' }],
    [{ token: 'abc', error: 'INVALID_TOKEN' }],
    [{ token: 'abc', error: '' }],
  ])('%j → null (link morto)', (q) => {
    expect(parseResetToken(q)).toBeNull()
  })
})

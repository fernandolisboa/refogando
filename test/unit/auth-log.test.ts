import { describe, it, expect, vi, afterEach } from 'vitest'
import { authLog } from '@/lib/auth'

/** Logger do Better Auth (#469): descarta o email sem conta e NÃO quebra quando a lib passa um Error. */
afterEach(() => vi.restoreAllMocks())

describe('authLog (#469)', () => {
  it('descarta a linha com o email digitado sem conta (LGPD)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    authLog('error', 'Reset Password: User not found', { email: 'x@y.z' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('descarta a tentativa de cadastro com email existente (#470 — PII e o próprio fato da enumeração)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    authLog('info', 'Sign-up attempt for existing email: x@y.z')
    expect(spy).not.toHaveBeenCalled()
  })

  it.each(['User not found', 'Credential account not found', 'Password not found'])(
    'descarta o login que falha com o email digitado (#276): "%s"',
    (message) => {
      // Mesmo shape de `better-auth/dist/api/routes/sign-in.mjs`: `logger.error(<mensagem>, { email })`.
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      authLog('error', message, { email: 'x@y.z' })
      expect(spy).not.toHaveBeenCalled()
    },
  )

  it('"Invalid password" (sem o email) continua saindo', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    authLog('error', 'Invalid password')
    expect(spy).toHaveBeenCalledWith('[Better Auth] Invalid password')
  })

  it('mensagem que é um Error (catch da lib) é logada, sem lançar', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('db down')
    expect(() => authLog('error', err)).not.toThrow()
    expect(spy).toHaveBeenCalledWith('[Better Auth]', err)
  })

  it('demais mensagens saem com prefixo, no nível certo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    authLog('warn', 'algo', 1)
    expect(warn).toHaveBeenCalledWith('[Better Auth] algo', 1)
  })
})

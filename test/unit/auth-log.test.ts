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

import { describe, expect, it } from 'vitest'
import { decideAdminAccess } from '@/server/auth/admin-access'

/**
 * Veredito PURO de acesso ao Console (#63, AC5 / segurança). Esta é a SEAM que o jsdom não
 * alcança (`headers()`/`getSession` só existem no servidor). A matriz cobre o caminho
 * sensível que a #51 mostrou propenso a fail-OPEN: papel `null`/desconhecido tem de cair em
 * `denied`, NUNCA em acesso. Sem DB, sem Better Auth — só (user cru) → veredito.
 */
describe('decideAdminAccess (gating do console, fail-closed)', () => {
  it('sem sessão (undefined/null) → redirect ao login', () => {
    expect(decideAdminAccess(undefined)).toBe('redirect')
    expect(decideAdminAccess(null)).toBe('redirect')
  })

  it('conta soft-deletada (deletedAt != null), qualquer papel → redirect', () => {
    expect(decideAdminAccess({ role: 'admin', deletedAt: new Date() })).toBe('redirect')
    expect(decideAdminAccess({ role: 'curador', deletedAt: '2026-01-01T00:00:00.000Z' })).toBe(
      'redirect',
    )
    // deletedAt vence o papel mesmo para admin — conta desativada = trate como anônimo.
    expect(decideAdminAccess({ role: 'admin', deletedAt: new Date(0) })).toBe('redirect')
  })

  it('autenticado com papel insuficiente (usuario) → denied', () => {
    expect(decideAdminAccess({ role: 'usuario' })).toBe('denied')
    expect(decideAdminAccess({ role: 'usuario', deletedAt: null })).toBe('denied')
  })

  it('FAIL-CLOSED — papel null/ausente/desconhecido → denied, nunca acesso', () => {
    expect(decideAdminAccess({ role: null })).toBe('denied')
    expect(decideAdminAccess({})).toBe('denied')
    expect(decideAdminAccess({ role: 'superusuario' })).toBe('denied')
    expect(decideAdminAccess({ role: '' })).toBe('denied')
  })

  it('curador → { role: "curador" }', () => {
    expect(decideAdminAccess({ role: 'curador' })).toEqual({ role: 'curador' })
    expect(decideAdminAccess({ role: 'curador', deletedAt: null })).toEqual({ role: 'curador' })
  })

  it('admin → { role: "admin" }', () => {
    expect(decideAdminAccess({ role: 'admin' })).toEqual({ role: 'admin' })
    expect(decideAdminAccess({ role: 'admin', deletedAt: null })).toEqual({ role: 'admin' })
  })
})

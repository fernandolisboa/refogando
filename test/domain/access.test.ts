import { describe, expect, it } from 'vitest'
import { decideRole } from '@/domain/access'
import type { Role } from '@/domain/user'

/**
 * Decisão de gating PURA (T5, #5.AC1). Sem DB, sem Better Auth — só a matriz
 * (papel, mínimo) → veredito, incluindo o caso fail-closed de papel desconhecido (E11).
 */
describe('decideRole (gating puro)', () => {
  it('sem papel (Visitante) → unauthenticated', () => {
    expect(decideRole(null, 'usuario')).toBe('unauthenticated')
    expect(decideRole(null, 'admin')).toBe('unauthenticated')
  })

  it('papel abaixo do mínimo → forbidden', () => {
    expect(decideRole('usuario', 'curador')).toBe('forbidden')
    expect(decideRole('usuario', 'admin')).toBe('forbidden')
    expect(decideRole('curador', 'admin')).toBe('forbidden')
  })

  it('papel igual ou acima do mínimo → allow', () => {
    expect(decideRole('usuario', 'usuario')).toBe('allow')
    expect(decideRole('curador', 'usuario')).toBe('allow')
    expect(decideRole('curador', 'curador')).toBe('allow')
    expect(decideRole('admin', 'usuario')).toBe('allow')
    expect(decideRole('admin', 'curador')).toBe('allow')
    expect(decideRole('admin', 'admin')).toBe('allow')
  })

  it('E11 — papel desconhecido (rank undefined) é FAIL-CLOSED → forbidden, nunca allow', () => {
    // Simula um valor de papel fora de ROLES (não deveria ocorrer com o pgEnum, mas o
    // guard precisa ser fail-closed se ocorrer). Cast deliberado para forçar o caminho.
    const desconhecido = 'superusuario' as Role
    expect(decideRole(desconhecido, 'usuario')).toBe('forbidden')
    expect(decideRole(desconhecido, 'admin')).toBe('forbidden')
  })
})

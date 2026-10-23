import { describe, expect, it } from 'vitest'
import { FRESH_SESSION_MAX_AGE_MS, isFreshSession } from '@/domain/fresh-session'

/** #602 — a regra de sessão recente para excluir a conta (servidor e diálogo usam a mesma). */
describe('isFreshSession', () => {
  const now = new Date('2026-10-23T12:00:00Z')

  it('recente até 24 h depois da criação, antiga a partir daí', () => {
    expect(FRESH_SESSION_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000)
    expect(isFreshSession(new Date(now.getTime() - 60_000), now)).toBe(true)
    expect(isFreshSession(new Date(now.getTime() - FRESH_SESSION_MAX_AGE_MS + 1), now)).toBe(true)
    expect(isFreshSession(new Date(now.getTime() - FRESH_SESSION_MAX_AGE_MS), now)).toBe(false)
  })

  it('aceita a data como string ISO (JSON do get-session)', () => {
    expect(isFreshSession('2026-10-23T11:00:00.000Z', now)).toBe(true)
    expect(isFreshSession('2026-10-21T11:00:00.000Z', now)).toBe(false)
  })

  it('data ausente ou inválida ⇒ não recente (fail-closed)', () => {
    expect(isFreshSession(null, now)).toBe(false)
    expect(isFreshSession(undefined, now)).toBe(false)
    expect(isFreshSession('ontem', now)).toBe(false)
  })
})

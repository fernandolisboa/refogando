import { describe, expect, it } from 'vitest'
import { ERASED_ACCOUNT_NAME, erasedIdentity } from '@/domain/account-erasure'

/**
 * Kernel puro da identidade anonimizada da eliminação de conta (#401). Estável, único, sem PII.
 */
describe('erasedIdentity (#401)', () => {
  const id = '11111111-2222-3333-4444-555555555555'

  it('deriva e-mail não-endereçável, handle válido e nome neutro a partir do id opaco', () => {
    const idn = erasedIdentity(id)
    expect(idn.email).toBe(`deleted-${id}@deleted.refogando.invalid`)
    expect(idn.handle).toBe(`removido-${id}`)
    expect(idn.name).toBe(ERASED_ACCOUNT_NAME)
    // Handle no formato público [a-z0-9-] (o uuid é hex + hífens).
    expect(idn.handle).toMatch(/^[a-z0-9-]+$/)
    // Domínio reservado .invalid (RFC 2606): nunca é entregável.
    expect(idn.email.endsWith('.invalid')).toBe(true)
  })

  it('é ESTÁVEL/determinístico: o mesmo id gera sempre os mesmos valores (idempotência)', () => {
    expect(erasedIdentity(id)).toEqual(erasedIdentity(id))
  })

  it('é ÚNICO por id: ids distintos não colidem (respeita a UNIQUE de email/handle)', () => {
    const other = '99999999-8888-7777-6666-555555555555'
    expect(erasedIdentity(id).email).not.toBe(erasedIdentity(other).email)
    expect(erasedIdentity(id).handle).not.toBe(erasedIdentity(other).handle)
  })

  it('NÃO deriva da PII: a forma anonimizada não contém e-mail/nome reais', () => {
    // Só o id opaco entra — a função nem recebe a PII.
    const idn = erasedIdentity(id)
    expect(idn.email).not.toContain('@gmail')
    expect(idn.name).not.toMatch(/@/)
  })
})

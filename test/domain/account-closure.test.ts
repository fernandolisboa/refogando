import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CLOSURE_REASONS,
  canRemovePublicContent,
  closureEmailApplies,
  confirmsHandle,
  isAccountClosureReason,
} from '@/domain/account-closure'

/** Regras puras do encerramento de conta pela equipe (#606, ADR-0051 P1/P3). */
describe('account-closure', () => {
  it('motivos: lista fechada, guard de borda', () => {
    expect(ACCOUNT_CLOSURE_REASONS).toEqual(['menor_16', 'violacao_grave'])
    expect(isAccountClosureReason('menor_16')).toBe(true)
    expect(isAccountClosureReason('outro')).toBe(false)
    expect(isAccountClosureReason(1)).toBe(false)
  })

  it('conteúdo público só sai no menor de 16; o e-mail de encerramento só vai na violação', () => {
    expect(canRemovePublicContent('menor_16')).toBe(true)
    expect(canRemovePublicContent('violacao_grave')).toBe(false)
    expect(closureEmailApplies('violacao_grave')).toBe(true)
    expect(closureEmailApplies('menor_16')).toBe(false)
  })

  it('confirmação digitada: com ou sem @, espaços e maiúsculas tolerados; vazio ou outro @ não', () => {
    expect(confirmsHandle('ana-souza', 'ana-souza')).toBe(true)
    expect(confirmsHandle(' @Ana-Souza ', 'ana-souza')).toBe(true)
    expect(confirmsHandle('ana', 'ana-souza')).toBe(false)
    expect(confirmsHandle('', 'ana-souza')).toBe(false)
    expect(confirmsHandle('@', 'ana-souza')).toBe(false)
  })
})

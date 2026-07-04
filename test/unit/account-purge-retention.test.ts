import { afterEach, describe, expect, it } from 'vitest'
import { RETENTION_DAYS } from '@/domain/account-purge'
import { resolveRetentionDays } from '@/server/legal/account-purge-scan'

/**
 * Guarda de SEGURANÇA do job DESTRUTIVO de expurgo (#411): o override por env
 * `ACCOUNT_PURGE_RETENTION_DAYS` só pode ENCURTAR a retenção de propósito e com um inteiro
 * positivo explícito. Qualquer valor acidental (vazio, espaço, 0, negativo, NaN, fracionário)
 * DEVE cair no default conservador — senão um `0` acidental expurgaria TODAS as contas anonimizadas.
 */
describe('resolveRetentionDays — fail-safe do override de retenção', () => {
  const KEY = 'ACCOUNT_PURGE_RETENTION_DAYS'
  afterEach(() => {
    delete process.env[KEY]
  })

  it('ausente → default conservador', () => {
    delete process.env[KEY]
    expect(resolveRetentionDays()).toBe(RETENTION_DAYS)
  })

  it.each(['', '   ', '0', '-5', 'abc', 'NaN', '3.5', ' 12x'])(
    'valor acidental %j → default conservador (nunca 0-dia)',
    (bad) => {
      process.env[KEY] = bad
      expect(resolveRetentionDays()).toBe(RETENTION_DAYS)
    },
  )

  it('inteiro positivo explícito → respeitado', () => {
    process.env[KEY] = '30'
    expect(resolveRetentionDays()).toBe(30)
  })
})

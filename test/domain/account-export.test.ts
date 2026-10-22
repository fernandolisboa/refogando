import { describe, it, expect } from 'vitest'
import { ACCOUNT_EXPORT_FILENAME_PREFIX, accountExportFilename } from '@/domain/account-export'

/** Export LGPD da conta (#595) — o nome do arquivo baixado, com a data em UTC (a mesma do `exportedAt`). */
describe('accountExportFilename', () => {
  it('prefixo + data UTC + .json', () => {
    expect(accountExportFilename(new Date('2026-10-22T23:59:59Z'))).toBe('refogando-meus-dados-2026-10-22.json')
    expect(ACCOUNT_EXPORT_FILENAME_PREFIX).toBe('refogando-meus-dados')
  })

  it('a data é a do UTC, não a do fuso local (22h de Brasília já é o dia seguinte)', () => {
    expect(accountExportFilename(new Date('2026-10-22T22:00:00-03:00'))).toBe('refogando-meus-dados-2026-10-23.json')
    expect(accountExportFilename(new Date('2026-10-23T01:00:00-03:00'))).toBe('refogando-meus-dados-2026-10-23.json')
  })
})

import { describe, expect, it } from 'vitest'
import {
  REPORT_STATUSES,
  isReportStatus,
  decideModerationReason,
} from '@/domain/report'

/**
 * Kernel de domínio do Report (issue #18). Puro — sem DB. Cobre o guard de status e o
 * validador de motivo obrigatório (AC2: o motivo é exigido para criar Report e para
 * remover-do-pool).
 */

describe('report status (kernel)', () => {
  it('REPORT_STATUSES é a lista congelada pending/resolved/rejected', () => {
    expect(REPORT_STATUSES).toEqual(['pending', 'resolved', 'rejected'])
  })

  it('isReportStatus aceita os válidos e rejeita o resto', () => {
    expect(isReportStatus('pending')).toBe(true)
    expect(isReportStatus('resolved')).toBe(true)
    expect(isReportStatus('rejected')).toBe(true)
    expect(isReportStatus('approved')).toBe(false)
    expect(isReportStatus('')).toBe(false)
  })
})

describe('decideModerationReason (motivo obrigatório, AC2)', () => {
  it('motivo com texto ⇒ allowed', () => {
    expect(decideModerationReason({ reason: 'conteúdo impróprio' }).allowed).toBe(true)
  })

  it('motivo vazio / só espaços ⇒ rejeitado', () => {
    expect(decideModerationReason({ reason: '' }).allowed).toBe(false)
    expect(decideModerationReason({ reason: '   ' }).allowed).toBe(false)
    expect(decideModerationReason({ reason: '\t\n ' }).allowed).toBe(false)
  })
})

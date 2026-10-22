import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedCron } from '@/server/http/cron-auth'

/**
 * Gate dos crons (hardening #588): `Authorization: Bearer ${CRON_SECRET}` comparado em tempo constante
 * (SHA-256 + `timingSafeEqual`). Prova o contrato fail-closed: sem secret no ambiente ⇒ nega (mesmo com um
 * header que "bateria" com secret vazio), header ausente/errado/de outro esquema ⇒ nega, só o exato passa.
 * O tempo constante em si não é medível de forma estável em teste; aqui fica o comportamento.
 */
function req(authorization?: string): Request {
  const headers: Record<string, string> = {}
  if (authorization !== undefined) headers.authorization = authorization
  return new Request('http://localhost/api/cron/x', { headers })
}

describe('isAuthorizedCron — gate fail-closed dos crons', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sem CRON_SECRET no ambiente ⇒ nega, até com "Bearer " vazio', () => {
    vi.stubEnv('CRON_SECRET', '')
    expect(isAuthorizedCron(req('Bearer '))).toBe(false)
    expect(isAuthorizedCron(req('Bearer undefined'))).toBe(false)
    expect(isAuthorizedCron(req())).toBe(false)
  })

  it('header ausente ⇒ nega', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t')
    expect(isAuthorizedCron(req())).toBe(false)
  })

  it('secret errado (inclusive prefixo do certo, ou mais longo) ⇒ nega', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t')
    expect(isAuthorizedCron(req('Bearer errado'))).toBe(false)
    expect(isAuthorizedCron(req('Bearer s3cr3'))).toBe(false)
    expect(isAuthorizedCron(req('Bearer s3cr3t!'))).toBe(false)
  })

  it('esquema diferente de "Bearer " com o secret certo ⇒ nega', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t')
    expect(isAuthorizedCron(req('s3cr3t'))).toBe(false)
    expect(isAuthorizedCron(req('Basic s3cr3t'))).toBe(false)
    expect(isAuthorizedCron(req('bearer s3cr3t'))).toBe(false)
  })

  it('"Bearer <secret>" exato ⇒ autoriza', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t')
    expect(isAuthorizedCron(req('Bearer s3cr3t'))).toBe(true)
  })
})

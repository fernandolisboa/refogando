import { describe, expect, it } from 'vitest'
import { assertNotProductionTestDb } from '../helpers/production-db-guard'

// Regressão da auditoria 2026-11-01 (ARCH-01): o harness nunca roda contra o banco de produção.
const PROD_POOLED = 'postgresql://neondb_owner:x@ep-gentle-morning-abc123-pooler.sa-east-1.aws.neon.tech/neondb'
const PROD_DIRECT = 'postgresql://neondb_owner:x@ep-gentle-morning-abc123.sa-east-1.aws.neon.tech/neondb'
const OTHER = 'postgresql://u:x@ep-quiet-test-999.sa-east-1.aws.neon.tech/neondb'

describe('assertNotProductionTestDb', () => {
  it('aceita ambiente sem TEST_DATABASE_URL (caminho Testcontainers)', () => {
    expect(() => assertNotProductionTestDb({ DATABASE_URL: PROD_POOLED })).not.toThrow()
  })

  it('aceita um servidor de teste distinto do da app', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: OTHER, DATABASE_URL: 'postgres://a@localhost/db' })).not.toThrow()
  })

  it('recusa o host de produção, pooled ou direto, sem precisar de DATABASE_URL', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: PROD_POOLED })).toThrow(/PRODUÇÃO/)
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL_UNPOOLED: PROD_DIRECT })).toThrow(/PRODUÇÃO/)
  })

  it('recusa quando o teste aponta para o mesmo host do banco da app (ignorando -pooler)', () => {
    const appDirect = 'postgresql://u:x@ep-app-1.neon.tech/neondb'
    const testPooled = 'postgresql://u:x@ep-app-1-pooler.neon.tech/outro'
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: testPooled, DATABASE_URL_UNPOOLED: appDirect })).toThrow(
      /mesmo host/,
    )
  })

  it('recusa URL inválida em vez de seguir adiante', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: 'não-é-url' })).toThrow(/não é uma URL/)
  })
})

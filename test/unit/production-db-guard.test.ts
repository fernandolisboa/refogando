import { describe, expect, it } from 'vitest'
import {
  assertNotProductionDbUrl,
  assertNotProductionTestDb,
  isProductionDbUrl,
} from '../helpers/production-db-guard'
import { createThrowawayDb } from '../helpers/throwaway-db'

// Regressão da auditoria 2026-11-01 (H-3): os harnesses nunca rodam contra o banco de produção.
const PROD_POOLED = 'postgresql://neondb_owner:x@ep-gentle-morning-abc123-pooler.sa-east-1.aws.neon.tech/neondb'
const PROD_DIRECT = 'postgresql://neondb_owner:x@ep-gentle-morning-abc123.sa-east-1.aws.neon.tech/neondb'
const OTHER = 'postgresql://u:x@ep-quiet-test-999.sa-east-1.aws.neon.tech/neondb'

describe('isProductionDbUrl / assertNotProductionDbUrl', () => {
  it('reconhece o host de produção, pooled, direto, em maiúsculas e com espaços', () => {
    expect(isProductionDbUrl(PROD_POOLED)).toBe(true)
    expect(isProductionDbUrl(PROD_DIRECT)).toBe(true)
    expect(isProductionDbUrl(`  ${PROD_DIRECT.replace('ep-gentle-morning', 'EP-GENTLE-MORNING')}  `)).toBe(true)
    expect(isProductionDbUrl(OTHER)).toBe(false)
    expect(isProductionDbUrl('postgres://postgres@localhost:5433/postgres')).toBe(false)
  })

  it('a mensagem nomeia a variável de origem', () => {
    expect(() => assertNotProductionDbUrl(PROD_DIRECT, 'E2E_DATABASE_URL')).toThrow(/E2E_DATABASE_URL.*PRODUÇÃO/)
  })
})

describe('assertNotProductionTestDb', () => {
  it('aceita ambiente sem TEST_DATABASE_URL (caminho Testcontainers)', () => {
    expect(() => assertNotProductionTestDb({ DATABASE_URL: PROD_POOLED })).not.toThrow()
  })

  it('aceita um servidor de teste distinto do da app', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: OTHER, DATABASE_URL: PROD_POOLED })).not.toThrow()
  })

  it('recusa o host de produção, pooled ou direto, sem precisar de DATABASE_URL', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: PROD_POOLED })).toThrow(/PRODUÇÃO/)
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL_UNPOOLED: PROD_DIRECT })).toThrow(/PRODUÇÃO/)
  })

  it('recusa quando o teste aponta para o mesmo servidor do banco da app (ignorando -pooler)', () => {
    const appDirect = 'postgresql://u:x@ep-app-1.neon.tech/neondb'
    const testPooled = 'postgresql://u:x@ep-app-1-pooler.neon.tech/outro'
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: testPooled, DATABASE_URL_UNPOOLED: appDirect })).toThrow(
      /mesmo servidor/,
    )
    expect(() =>
      assertNotProductionTestDb({ TEST_DATABASE_URL: OTHER, TEST_DATABASE_URL_UNPOOLED: appDirect, POSTGRES_URL: appDirect }),
    ).toThrow(/TEST_DATABASE_URL_UNPOOLED.*mesmo servidor/)
  })

  it('compara também com as variáveis só de host (PGHOST*, POSTGRES_HOST), na porta 5432', () => {
    expect(() =>
      assertNotProductionTestDb({ TEST_DATABASE_URL: 'postgresql://u:x@ep-app-1.neon.tech/x', PGHOST: 'ep-app-1-pooler.neon.tech' }),
    ).toThrow(/mesmo servidor/)
    expect(() =>
      assertNotProductionTestDb({ TEST_DATABASE_URL: 'postgresql://u:x@ep-app-1.neon.tech:6543/x', PGHOST: 'ep-app-1.neon.tech' }),
    ).not.toThrow()
  })

  it('mesmo host em porta diferente é outro servidor', () => {
    expect(() =>
      assertNotProductionTestDb({
        TEST_DATABASE_URL: 'postgresql://u:x@db.example.com:5433/postgres',
        DATABASE_URL: 'postgresql://u:x@db.example.com/refogando',
      }),
    ).not.toThrow()
  })

  it('loopback é sempre de dev: o mesmo Postgres local da app pode hospedar os bancos descartáveis', () => {
    expect(() =>
      assertNotProductionTestDb({
        TEST_DATABASE_URL: 'postgres://postgres@localhost:5432/postgres',
        DATABASE_URL: 'postgres://postgres@localhost:5432/refogando',
      }),
    ).not.toThrow()
  })

  it('recusa URL inválida em vez de seguir adiante, mesmo com a outra variável válida', () => {
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: 'não-é-url' })).toThrow(/não é uma URL/)
    expect(() => assertNotProductionTestDb({ TEST_DATABASE_URL: OTHER, TEST_DATABASE_URL_UNPOOLED: 'x' })).toThrow(
      /TEST_DATABASE_URL_UNPOOLED não é uma URL/,
    )
  })
})

describe('createThrowawayDb', () => {
  // A trava roda na URL que o helper VAI usar, antes de conectar: vale para os dois harnesses, venha de que variável vier.
  it('recusa um adminUrl de produção antes de abrir conexão', async () => {
    await expect(
      createThrowawayDb({ dbName: 'refogando_test_x', safeName: /^refogando_test_[a-z0-9]+$/, adminUrl: PROD_DIRECT }),
    ).rejects.toThrow(/PRODUÇÃO/)
  })
})

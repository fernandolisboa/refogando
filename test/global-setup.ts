import type { ProvidedContext } from 'vitest'
import { makeSql } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'
import { createThrowawayDb, randSuffix } from './helpers/throwaway-db'

/**
 * Harness de integração — Postgres REAL e descartável, provider NEUTRO, auto-detect:
 *  - SEM TEST_DATABASE_URL → sobe um container pgvector/pgvector (Testcontainers) e
 *    o derruba no fim. Default local (precisa de Docker).
 *  - COM TEST_DATABASE_URL → cria um banco refogando_test_<rand> num endpoint DIRETO,
 *    migra, e dá DROP ... WITH (FORCE) no fim. Use em CI ou sem Docker.
 *
 * Em ambos: o banco descartável é migrado uma vez aqui (extensões + tabelas) e sua
 * URL é repassada aos workers via `provide('databaseUrl', ...)`.
 */

/** Forma segura do nome do banco descartável, nos dois caminhos (helper `createThrowawayDb`, #593). */
const SAFE_DB_NAME = /^refogando_test_[a-z0-9]+$/

/** Endpoint direto/unpooled para admin (CREATE/DROP DATABASE) e migrator. */
function pickAdminUrl(): string {
  const direct =
    process.env.TEST_DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING
  if (direct?.trim()) return direct.trim()
  // Best-effort: derivar o host direto removendo "-pooler" (convenção Neon).
  const pooled = process.env.TEST_DATABASE_URL!.trim()
  if (/-pooler\./.test(pooled)) {
    console.warn(
      '[harness] TEST_DATABASE_URL é um endpoint pooled; derivando o endpoint direto ' +
        '(remova "-pooler"). Defina TEST_DATABASE_URL_UNPOOLED para evitar a heurística.',
    )
    return pooled.replace('-pooler.', '.')
  }
  return pooled
}

type GlobalSetupContext = {
  provide: <K extends keyof ProvidedContext>(key: K, value: ProvidedContext[K]) => void
}

export default async function setup({ provide }: GlobalSetupContext) {
  // Mesmo padrão de nome nos dois caminhos (no container também, em vez do default "test"): testes que
  // mexem no próprio banco (ALTER DATABASE) conferem current_database() contra ele antes. Com
  // TEST_DATABASE_URL a varredura apaga todo órfão `refogando_test_*` sem sessão (sem FORCE).
  const db = await createThrowawayDb({
    dbName: `refogando_test_${randSuffix()}`,
    safeName: SAFE_DB_NAME,
    adminUrl: process.env.TEST_DATABASE_URL?.trim() ? pickAdminUrl() : undefined,
  })
  const { url: appUrl, dbName } = db

  // Migra o banco descartável (extensões unaccent/vector + tabelas) com max:1.
  // Se a migração falhar, o Vitest ainda não registrou o teardown (só registra
  // após setup() resolver) — então limpamos aqui mesmo antes de re-lançar, senão
  // o banco recém-criado fica órfão.
  const migrationSql = makeSql(appUrl, { max: 1 })
  try {
    await runMigrations(migrationSql)
    // Sanidade: confirmamos que migramos o banco certo (não caímos noutro).
    const [{ current_database }] = await migrationSql<{ current_database: string }[]>`
      select current_database()
    `
    if (current_database !== dbName) {
      throw new Error(`migrei o banco errado: ${current_database}`)
    }
  } catch (err) {
    await migrationSql.end({ timeout: 5 }).catch(() => {})
    await db.drop().catch(() => {})
    throw err
  }
  await migrationSql.end({ timeout: 10 })

  provide('databaseUrl', appUrl)

  return () => db.drop()
}

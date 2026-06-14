import type { ProvidedContext } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { makeSql } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'

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

const IMAGE = 'pgvector/pgvector:pg17'

function randSuffix(): string {
  // [a-z0-9], sem depender de crypto; suficiente para nome de banco efêmero.
  return Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '') || 'x'
}

function assertSafeDbName(name: string): void {
  if (!/^refogando_test_[a-z0-9]+$/.test(name)) {
    throw new Error(`nome de banco inseguro: ${name}`)
  }
}

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

function swapDbName(url: string, dbName: string): string {
  const u = new URL(url)
  u.pathname = `/${dbName}`
  return u.toString()
}

type GlobalSetupContext = {
  provide: <K extends keyof ProvidedContext>(key: K, value: ProvidedContext[K]) => void
}

export default async function setup({ provide }: GlobalSetupContext) {
  const external = process.env.TEST_DATABASE_URL?.trim()
  let appUrl: string
  let container: StartedPostgreSqlContainer | null = null
  let dropThrowawayDb: (() => Promise<void>) | null = null

  if (external) {
    const adminUrl = pickAdminUrl()
    const dbName = `refogando_test_${randSuffix()}`
    assertSafeDbName(dbName)

    const admin = makeSql(adminUrl, { max: 1 })
    try {
      // Sweep best-effort de órfãos de execuções anteriores que morreram (SIGKILL/
      // crash). Sem FORCE: um banco em uso por um run concorrente não dropa (erro
      // engolido) — só órfãos sem sessão somem. Nomes vêm do catálogo + padrão fixo.
      const orphans = await admin<{ datname: string }[]>`
        select datname from pg_database where datname like 'refogando_test_%'
      `
      for (const o of orphans) {
        try {
          await admin.unsafe(`DROP DATABASE IF EXISTS "${o.datname}"`)
        } catch {
          // em uso por outro run: deixa quieto.
        }
      }
      await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    } finally {
      await admin.end({ timeout: 5 })
    }

    appUrl = swapDbName(adminUrl, dbName)
    dropThrowawayDb = async () => {
      const a = makeSql(adminUrl, { max: 1 })
      try {
        await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
      } finally {
        await a.end({ timeout: 5 })
      }
    }
  } else {
    container = await new PostgreSqlContainer(IMAGE).start()
    appUrl = container.getConnectionUri()
  }

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
    if (external && !current_database.startsWith('refogando_test_')) {
      throw new Error(`migrei o banco errado: ${current_database}`)
    }
  } catch (err) {
    await migrationSql.end({ timeout: 5 }).catch(() => {})
    if (dropThrowawayDb) await dropThrowawayDb().catch(() => {})
    if (container) await container.stop().catch(() => {})
    throw err
  }
  await migrationSql.end({ timeout: 10 })

  provide('databaseUrl', appUrl)

  return async () => {
    try {
      if (dropThrowawayDb) await dropThrowawayDb()
    } finally {
      if (container) await container.stop()
    }
  }
}

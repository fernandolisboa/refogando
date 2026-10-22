import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parse as parseDotenv } from 'dotenv'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { makeSql } from '@/db/client'
import { runMigrations } from '@/db/migrate'
import { isLoopbackUrl, VERCEL_MARKERS } from '@/server/e2e/mode'
import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_BUILD_MARKER,
  E2E_DB_NAME_RE,
  E2E_ORPHAN_MIN_AGE_MS,
  E2E_PORT,
} from './constants'
import { seedE2e } from './seed'

/**
 * Harness do E2E (#589) — é o `webServer.command` do Playwright. O Playwright sobe o webServer ANTES do
 * globalSetup, então TUDO acontece aqui, em ordem: banco descartável → migrações → seed → `next build` →
 * `next start` em localhost:3100, no MODO FAKE (`REFOGANDO_E2E_FAKES=1`, ver src/server/e2e/mode.ts).
 * SIGTERM/SIGINT (o Playwright ao fim) ⇒ derruba o Next e apaga o banco / para o container.
 *
 * Banco (espelha test/global-setup.ts; duplicado de propósito — unificar os dois é o follow-up #593):
 *  - SEM `E2E_DATABASE_URL` ⇒ Testcontainers `pgvector/pgvector:pg17` (precisa de Docker local);
 *  - COM `E2E_DATABASE_URL` (só loopback) ⇒ CREATE DATABASE refogando_e2e_<epoch>_<rand> nesse Postgres e
 *    DROP ... WITH (FORCE) no fim. Varre órfãos com mais de 2h de execuções que morreram.
 * `DATABASE_URL`/`TEST_DATABASE_URL` do shell são IGNORADAS (podem apontar pra produção).
 *
 * Ambiente do Next: o `@next/env` carregaria `.env.production.local`, `.env.local`, `.env.production` e
 * `.env` para toda chave `undefined` — e o `.env.local` deste repo aponta pra PRODUÇÃO. Defesa em camadas:
 * toda chave desses arquivos (e a lista fixa abaixo) vai como '' para o filho, e `__NEXT_PROCESSED_ENV`
 * faz o Next nem abrir os arquivos.
 */

const IMAGE = 'pgvector/pgvector:pg17'
const DOTENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env']
/** Chaves de provedor/infra zeradas mesmo sem `.env*` (o shell de quem roda pode tê-las exportadas). */
const BLANK_KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'RESEND_API_KEY',
  'AUTH_MAIL_FROM',
  'DSAR_MAIL_FROM',
  'DSAR_DPO_EMAIL',
  'BLOB_READ_WRITE_TOKEN',
  'WEB_SEARCH_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CRON_SECRET',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'TEST_DATABASE_URL',
  'TEST_DATABASE_URL_UNPOOLED',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'TRANSLATION_MODEL',
  'MENU_MODEL',
  'IMAGE_SCENE_MODEL',
  'EXTRACTION_MODEL',
  'ACCOUNT_PURGE_RETENTION_DAYS',
  ...VERCEL_MARKERS,
]

const log = (msg: string) => console.log(`[e2e/harness] ${msg}`)

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '') || 'x'
}

function assertSafeDbName(name: string): void {
  if (!E2E_DB_NAME_RE.test(name)) throw new Error(`nome de banco inseguro: ${name}`)
}

/** Instante (ms) gravado no nome do banco; `null` se o nome não é do harness. */
function dbCreatedAtMs(name: string): number | null {
  const m = E2E_DB_NAME_RE.exec(name)
  return m ? Number(m[1]) * 1000 : null
}

function swapDbName(url: string, dbName: string): string {
  const u = new URL(url)
  u.pathname = `/${dbName}`
  return u.toString()
}

type ThrowawayDb = { url: string; dbName: string; drop: () => Promise<void> }

async function createThrowawayDb(): Promise<ThrowawayDb> {
  const dbName = `refogando_e2e_${Math.floor(Date.now() / 1000)}_${randSuffix()}`
  assertSafeDbName(dbName)
  const external = process.env.E2E_DATABASE_URL?.trim()

  if (external) {
    if (!isLoopbackUrl(external, ['postgres:', 'postgresql:'])) {
      throw new Error('E2E_DATABASE_URL precisa ser postgres:// em loopback (localhost/127.0.0.1/::1).')
    }
    const admin = makeSql(external, { max: 1 })
    try {
      // Órfãos de execuções que morreram (SIGKILL), pela idade gravada no nome. Só os com mais de
      // E2E_ORPHAN_MIN_AGE_MS: outro run local concorrente fica minutos sem conexão aberta no banco dele
      // (durante o `next build`, por exemplo), e um DROP sem FORCE o derrubaria nessa janela. Sem FORCE
      // mesmo assim (um órfão velho ainda conectado não cai). Nome fora do padrão (inclusive o formato
      // antigo, sem o instante) fica quieto.
      const orphans = await admin<{ datname: string }[]>`
        select datname from pg_database where datname like 'refogando_e2e_%'
      `
      const cutoff = Date.now() - E2E_ORPHAN_MIN_AGE_MS
      for (const o of orphans) {
        const createdAt = dbCreatedAtMs(o.datname)
        if (createdAt === null || createdAt > cutoff) continue
        try {
          await admin.unsafe(`DROP DATABASE IF EXISTS "${o.datname}"`)
          log(`órfão ${o.datname} apagado`)
        } catch {
          // ainda em uso: deixa quieto.
        }
      }
      await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    } finally {
      await admin.end({ timeout: 5 })
    }
    log(`banco ${dbName} criado em ${new URL(external).host}`)
    return {
      url: swapDbName(external, dbName),
      dbName,
      drop: async () => {
        const a = makeSql(external, { max: 1 })
        try {
          await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
        } finally {
          await a.end({ timeout: 5 })
        }
        log(`banco ${dbName} apagado`)
      },
    }
  }

  // Import tardio: sem Docker (caminho E2E_DATABASE_URL) nem carrega o Testcontainers.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  log(`subindo ${IMAGE} (Testcontainers)…`)
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE).withDatabase(dbName).start()
  const url = container.getConnectionUri()
  if (!isLoopbackUrl(url, ['postgres:', 'postgresql:'])) {
    await container.stop().catch(() => {})
    throw new Error(`o Testcontainers expôs o banco fora de loopback (${container.getHost()}); use Docker local.`)
  }
  return {
    url,
    dbName,
    drop: async () => {
      await container.stop()
      log('container parado')
    },
  }
}

/** Env do `next build`/`next start`: o do shell, com provedores/.env* zerados e o modo fake ligado. */
function nextEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const file of DOTENV_FILES) {
    if (!existsSync(file)) continue
    for (const key of Object.keys(parseDotenv(readFileSync(file)))) env[key] = ''
  }
  for (const key of BLANK_KEYS) env[key] = ''
  // NODE_ENV do shell (ex. 'test') confundiria o Next; ele mesmo define 'production' em build/start.
  delete env.NODE_ENV
  Object.assign(env, {
    REFOGANDO_E2E_FAKES: '1',
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    BETTER_AUTH_URL: E2E_BASE_URL,
    APP_URL: E2E_BASE_URL,
    NEXT_TELEMETRY_DISABLED: '1',
    __NEXT_PROCESSED_ENV: 'true',
  })
  // O tipo do Next exige NODE_ENV em ProcessEnv; aqui ele falta de propósito (ver acima).
  return env as NodeJS.ProcessEnv
}

const NEXT_BIN = require.resolve('next/dist/bin/next')

function runNext(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [NEXT_BIN, ...args], { env, stdio: 'inherit' })
}

/** Espera o filho sair. Já morto (por código OU por sinal: aí `exitCode` fica null) ⇒ resolve na hora. */
function waitExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode)
    if (child.signalCode !== null) return resolve(1)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

async function main(): Promise<void> {
  const vercel = VERCEL_MARKERS.filter((k) => !!process.env[k])
  if (vercel.length > 0) throw new Error(`recusado: marcador da Vercel no ambiente (${vercel.join(', ')}).`)

  let db: ThrowawayDb | null = null
  let next: ChildProcess | null = null
  let shuttingDown = false
  let cleanupPromise: Promise<void> | null = null

  // Idempotente (memoiza a promise): sinal + morte do Next podem chegar juntos.
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (next && next.exitCode === null && next.signalCode === null) {
        next.kill('SIGTERM')
        const killer = setTimeout(() => next?.kill('SIGKILL'), 10_000)
        await waitExit(next)
        clearTimeout(killer)
      }
      if (db) await db.drop().catch((err) => console.error('[e2e/harness] falha ao limpar o banco:', err))
    })()
    return cleanupPromise
  }

  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    log(`${signal}: encerrando…`)
    void cleanup().finally(() => process.exit(0))
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  try {
    db = await createThrowawayDb()
    const sql = makeSql(db.url, { max: 1 })
    try {
      await runMigrations(sql)
      await seedE2e(sql, db.dbName)
    } finally {
      await sql.end({ timeout: 5 })
    }
    log('migrado e semeado')
    if (shuttingDown) return

    const env = nextEnv(db.url)
    if (process.env.E2E_SKIP_BUILD === '1') {
      // Atalho LOCAL: só reaproveita um build feito por ESTE harness (o `next build` normal apaga o marcador).
      if (!existsSync(E2E_BUILD_MARKER)) {
        throw new Error(`E2E_SKIP_BUILD=1 sem ${E2E_BUILD_MARKER}: rode uma vez sem a variável.`)
      }
      log('E2E_SKIP_BUILD=1: reaproveitando o build anterior do harness')
    } else {
      log('next build (com o banco, como na Vercel)…')
      const code = await waitExit((next = runNext(['build'], env)))
      next = null
      if (shuttingDown) return
      if (code !== 0) throw new Error(`next build falhou (código ${code})`)
      writeFileSync(E2E_BUILD_MARKER, JSON.stringify({ builtAt: new Date().toISOString() }))
    }

    log(`next start em ${E2E_BASE_URL}`)
    next = runNext(['start', '-p', String(E2E_PORT), '-H', 'localhost'], env)
    const code = await waitExit(next)
    if (shuttingDown) return
    throw new Error(`next start saiu sozinho (código ${code})`)
  } catch (err) {
    if (shuttingDown) return
    shuttingDown = true
    console.error('[e2e/harness] falhou:', err instanceof Error ? err.message : err)
    await cleanup()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[e2e/harness] erro inesperado:', err instanceof Error ? err.message : err)
  process.exit(1)
})

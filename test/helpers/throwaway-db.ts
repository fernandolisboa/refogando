import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { makeSql } from '@/db/client'
import { isLoopbackUrl } from '@/server/e2e/mode'

/**
 * Banco Postgres descartável dos dois harnesses (#593): o do Vitest (`test/global-setup.ts`) e o do E2E
 * (`e2e/harness/server.ts`). Dois caminhos:
 *  - COM `adminUrl` ⇒ varre órfãos de execuções que morreram, dá `CREATE DATABASE <dbName>` nesse Postgres
 *    (endpoint DIRETO: o pooler não aceita CREATE/DROP DATABASE) e `DROP ... WITH (FORCE)` no fim;
 *  - SEM `adminUrl` ⇒ Testcontainers `pgvector/pgvector:pg17` com o banco `<dbName>`, parado no fim.
 *
 * O nome entra cru no `CREATE`/`DROP DATABASE`, então `safeName` é a ÚNICA forma que o helper cria ou apaga,
 * inclusive na varredura de órfãos (nome do catálogo fora do padrão fica quieto). Quem chama monta o nome e
 * decide quais órfãos podem sair (`sweepOrphan`: o E2E só os com mais de 2h). Migrar e semear são do
 * chamador. Sem dependência do Vitest: o harness do E2E roda em `node --import tsx`.
 */

const IMAGE = 'pgvector/pgvector:pg17'

export type ThrowawayDb = { url: string; dbName: string; drop: () => Promise<void> }

export type ThrowawayDbOptions = {
  /** Nome do banco. Precisa casar com `safeName`. */
  dbName: string
  /** Forma segura do nome (ancorada em `^…$`). Também filtra os órfãos que a varredura pode apagar. */
  safeName: RegExp
  /** Postgres onde criar o banco (endpoint direto). Ausente ⇒ Testcontainers. */
  adminUrl?: string
  /** Recusa host fora de loopback, no `adminUrl` e na URL que o Testcontainers expõe. */
  requireLoopback?: boolean
  /** Nome da variável de ambiente de onde veio o `adminUrl`, para a mensagem de erro. */
  adminUrlEnv?: string
  /** Dos órfãos com nome seguro, quais a varredura apaga. Ausente ⇒ todos (sem FORCE: o que está em uso fica). */
  sweepOrphan?: (dbName: string) => boolean
  log?: (msg: string) => void
}

/** Sufixo `[a-z0-9]` para o nome do banco; sem depender de crypto, suficiente para um banco efêmero. */
export function randSuffix(): string {
  return Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '') || 'x'
}

function swapDbName(url: string, dbName: string): string {
  const u = new URL(url)
  u.pathname = `/${dbName}`
  return u.toString()
}

function assertSafeDbName(name: string, safeName: RegExp): void {
  // Com `g`/`y` o `.test()` guarda `lastIndex` entre chamadas e passaria a responder errado na varredura; com `m`,
  // `^…$` casa uma LINHA só, e um nome do catálogo com quebra de linha levaria aspas ao DROP. Sem âncoras, idem.
  if (safeName.global || safeName.sticky || safeName.multiline) {
    throw new Error(`safeName não pode ter as flags g/y/m: ${safeName}`)
  }
  if (!safeName.source.startsWith('^') || !safeName.source.endsWith('$')) {
    throw new Error(`safeName precisa ser ancorado em ^…$: ${safeName}`)
  }
  if (!safeName.test(name)) throw new Error(`nome de banco inseguro: ${name}`)
}

export async function createThrowawayDb(opts: ThrowawayDbOptions): Promise<ThrowawayDb> {
  const { dbName, safeName, adminUrl, requireLoopback = false, adminUrlEnv = 'adminUrl' } = opts
  const { sweepOrphan = () => true, log = () => {} } = opts
  assertSafeDbName(dbName, safeName)

  if (adminUrl) {
    if (requireLoopback && !isLoopbackUrl(adminUrl, ['postgres:', 'postgresql:'])) {
      throw new Error(`${adminUrlEnv} precisa ser postgres:// em loopback (localhost/127.0.0.1/::1).`)
    }
    const admin = makeSql(adminUrl, { max: 1 })
    try {
      // Sem FORCE: um banco em uso por uma execução concorrente não cai (o erro é engolido); só órfão sem
      // sessão some. O catálogo é pequeno: filtra pelo `safeName` aqui, sem LIKE (onde `_` é curinga).
      const orphans = await admin<{ datname: string }[]>`select datname from pg_database`
      for (const o of orphans) {
        if (!safeName.test(o.datname) || !sweepOrphan(o.datname)) continue
        try {
          await admin.unsafe(`DROP DATABASE IF EXISTS "${o.datname}"`)
          log(`órfão ${o.datname} apagado`)
        } catch {
          // em uso por outra execução: deixa quieto.
        }
      }
      await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    } finally {
      await admin.end({ timeout: 5 })
    }
    log(`banco ${dbName} criado em ${new URL(adminUrl).host}`)
    return {
      url: swapDbName(adminUrl, dbName),
      dbName,
      drop: async () => {
        const a = makeSql(adminUrl, { max: 1 })
        try {
          await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
        } finally {
          await a.end({ timeout: 5 })
        }
        log(`banco ${dbName} apagado`)
      },
    }
  }

  // Import tardio: o caminho com `adminUrl` (sem Docker) nem carrega o Testcontainers.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  log(`subindo ${IMAGE} (Testcontainers)…`)
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE).withDatabase(dbName).start()
  const url = container.getConnectionUri()
  if (requireLoopback && !isLoopbackUrl(url, ['postgres:', 'postgresql:'])) {
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

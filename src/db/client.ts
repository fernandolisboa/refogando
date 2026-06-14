import postgres, { type Sql } from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

/**
 * TLS por host. Endpoint remoto/gerenciado → TLS COM verificação de certificado e
 * hostname (`rejectUnauthorized:true`, equivale a `verify-full`): só criptografar
 * sem verificar (o `ssl:'require'` do postgres.js, que faz `rejectUnauthorized:false`)
 * deixaria a conexão vulnerável a MITM. Nunca rebaixamos — só local sem sslmode
 * explícito (container/dev) dispensa TLS.
 */
function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // URL malformada: cai no ramo remoto seguro (verifica TLS).
  }
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
  if (isLocal && !/sslmode=(require|verify-ca|verify-full)/.test(url)) return false
  return { rejectUnauthorized: true }
}

/** Poolers em modo transação (PgBouncer/Neon -pooler) não suportam prepared
 * statements nomeados: `prepare:false` é obrigatório nesses endpoints. */
function isPooler(url: string): boolean {
  return /-pooler\./.test(url) || /pgbouncer=true/.test(url)
}

export type SqlOptions = {
  /** Tamanho do pool. Migrações exigem `max:1` (canal de sessão único). */
  max?: number
}

/** Cria um cliente postgres.js neutro a partir de uma connection string. */
export function makeSql(url: string, opts: SqlOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    prepare: !isPooler(url),
    ssl: sslFor(url),
    onnotice: () => {},
  })
}

/** Embrulha um cliente postgres.js com o schema do Drizzle (habilita db.query.*). */
export function makeDb(sql: Sql): Database {
  return drizzle(sql, { schema })
}

import postgres, { type Sql } from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

/** TLS é decidido pela própria connection string (sslmode). Só ligamos `require`
 * defensivamente para hosts gerenciados que possam omitir sslmode na URL; nunca
 * passamos `ssl:false` quando a URL pede TLS (isso sobrescreveria e quebraria). */
function needsSsl(url: string): boolean {
  return /sslmode=require/.test(url) || /\.neon\.tech/.test(url)
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
    ssl: needsSsl(url) ? 'require' : undefined,
    onnotice: () => {},
  })
}

/** Embrulha um cliente postgres.js com o schema do Drizzle (habilita db.query.*). */
export function makeDb(sql: Sql): Database {
  return drizzle(sql, { schema })
}

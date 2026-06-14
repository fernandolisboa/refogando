import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Sql } from 'postgres'

/**
 * Aplica as migrations da pasta ./drizzle a um cliente postgres.js.
 *
 * O cliente DEVE ser criado com `max:1` e apontar para um endpoint DIRETO/unpooled:
 * o migrator do Drizzle envolve cada migration numa transação e pega um advisory
 * lock de sessão, que poolers em modo transação não garantem.
 */
export async function runMigrations(sql: Sql): Promise<void> {
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle' })
}

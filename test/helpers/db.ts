import type { Sql } from 'postgres'

/**
 * Esvazia todas as tabelas do schema `public` (enumeradas dinamicamente, então
 * tabelas novas de #3+ são cobertas sem editar isto). RESTART IDENTITY deixa os
 * ids determinísticos por teste; CASCADE cuida das FKs.
 */
export async function truncateAll(sql: Sql): Promise<void> {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `
  if (rows.length === 0) return
  const list = rows.map((r) => `"${r.tablename}"`).join(', ')
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
}

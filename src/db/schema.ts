import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Tabela de smoke-test do harness de fundação (issue #2).
 *
 * NÃO é proto-Receita: deliberadamente sem domínio (nada de origin, owner_id,
 * visibility, result_kind, locale). A espinha canônica da Receita nasce na #3.
 * Existe só para o route handler de saúde tocar um Postgres real pela porta mais alta.
 */
export const ping = pgTable('ping', {
  id: serial('id').primaryKey(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

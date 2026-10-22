import { sql } from 'drizzle-orm'
import { getDb } from '@/server/deps'

/**
 * Roda `fn` com um trigger que reprova apagar QUALQUER linha de `table` (`BEFORE DELETE … FOR EACH ROW`, que
 * levanta `P0001`): o jeito de injetar uma falha no meio de uma transação de verdade. Só falha quem tem linha
 * na tabela; um DELETE que não acha nada passa. Função e trigger saem no `finally`.
 */
export async function withFailingTrigger(table: string, fn: () => Promise<void>): Promise<void> {
  const name = `test_falha_${table}`
  await getDb().execute(
    sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END $$`),
  )
  await getDb().execute(
    sql.raw(`CREATE TRIGGER ${name} BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`),
  )
  try {
    await fn()
  } finally {
    await getDb().execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON ${table}`))
    await getDb().execute(sql.raw(`DROP FUNCTION IF EXISTS ${name}()`))
  }
}

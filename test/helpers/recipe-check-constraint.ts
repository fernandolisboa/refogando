import { sql } from 'drizzle-orm'
import { getDb } from '@/server/deps'

/**
 * Gerência da CHECK `recipe_web_imported_private_chk` (#450, migração 0054) NO ESCOPO DE UM ARQUIVO.
 *
 * O #450 adicionou no BANCO o invariante `web_imported ⇒ private` como defesa-em-profundidade.
 * Três suítes de gate (following-feed, public-profile, recommended-cooks) precisam materializar o
 * estado ILEGAL `web_imported` + `public` — o "cinto-e-suspensório sem CHECK no DB" — pra provar
 * que o gate de ORIGEM da APLICAÇÃO (`origin <> 'web_imported'` em eligibleForPool, #168) exclui a
 * linha independentemente do banco. A CHECK rejeita esse estado tanto no INSERT quanto em UPDATEs
 * posteriores da linha (ex.: anexar imagem), então não dá pra "grandfatherar" a linha com NOT VALID.
 *
 * Solução: remover a CHECK durante o arquivo (`beforeAll(dropWebImportedPrivateCheck)`) e restaurá-la
 * no fim (`afterAll(restoreWebImportedPrivateCheck)`). Com `fileParallelism: false`, os arquivos rodam
 * em série e a CHECK só fica ausente DURANTE esses 3 arquivos — quando `recipe-constraints.test.ts`
 * (que testa o invariante) roda, a CHECK está presente e enforçando. O restore usa `NOT VALID`: não
 * escaneia as linhas remanescentes (sem dor de FK; o `truncateAll` do próximo arquivo as apaga) mas
 * segue barrando writes NOVOS — logo o teste de comportamento do #450 continua verde.
 */

const CONSTRAINT = 'recipe_web_imported_private_chk'
const CHECK_EXPR = `CHECK ("origin" <> 'web_imported' OR "visibility" = 'private')`

export async function dropWebImportedPrivateCheck(): Promise<void> {
  await getDb().execute(sql.raw(`ALTER TABLE recipe DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`))
}

export async function restoreWebImportedPrivateCheck(): Promise<void> {
  // Idempotente: dropa (caso ainda exista) e re-adiciona como NOT VALID.
  await getDb().execute(sql.raw(`ALTER TABLE recipe DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`))
  await getDb().execute(sql.raw(`ALTER TABLE recipe ADD CONSTRAINT ${CONSTRAINT} ${CHECK_EXPR} NOT VALID`))
}

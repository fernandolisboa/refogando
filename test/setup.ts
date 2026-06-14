import { afterAll, beforeAll, beforeEach, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeDb, makeSql } from '@/db/client'
import { setDb, resetDeps } from '@/server/deps'
import { truncateAll } from './helpers/db'

/**
 * setupFiles roda uma vez por arquivo de teste (em cada worker). Conecta no banco
 * descartável (URL injetada pelo globalSetup), aponta o DI da app para ele, e
 * garante banco limpo + seams resetados ANTES de cada teste (beforeEach, não só
 * afterEach: um teste que estoura não deixa lixo para o próximo).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
  setDb(makeDb(sql))
})

beforeEach(async () => {
  resetDeps()
  await truncateAll(sql)
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

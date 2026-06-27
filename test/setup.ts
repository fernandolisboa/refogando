import { afterAll, beforeAll, beforeEach, inject } from 'vitest'
import type { Sql } from 'postgres'
import type { Database } from '@/db/client'
import { makeDb, makeSql } from '@/db/client'
import { setDb, resetDeps } from '@/server/deps'
import { truncateAll } from './helpers/db'
import { seedVocabularyCozinhas } from './helpers/vocabulary'

/**
 * setupFiles roda uma vez por arquivo de teste (em cada worker). Conecta no banco
 * descartável (URL injetada pelo globalSetup), aponta o DI da app para ele, e
 * garante banco limpo + seams resetados ANTES de cada teste (beforeEach, não só
 * afterEach: um teste que estoura não deixa lixo para o próximo).
 */

let sql: Sql
let db: Database

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
  db = makeDb(sql)
  setDb(db)
})

beforeEach(async () => {
  resetDeps()
  await truncateAll(sql)
  // Baseline de PRODUÇÃO: `vocabulary_term` nunca está vazia — a migração 0033 (#314) semeia as
  // cozinhas no deploy. `truncateAll` apaga essa seed antes de cada teste, então re-semeamos o
  // baseline aqui (idempotente). Sem isto, as rotas de ESCRITA que passaram a validar `cozinha`
  // contra o conjunto-ativo carregado do DB (#316, ADR-0025) veriam um set vazio e rejeitariam
  // TODA cozinha com 400 — divergindo do prod, onde a seed sempre existe.
  await seedVocabularyCozinhas(db)
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

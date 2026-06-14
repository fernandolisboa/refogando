import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'

/**
 * Prova que o Postgres descartável tem as capacidades que as fatias seguintes
 * herdam: extensões unaccent/pgvector instaladas e configs de FTS por idioma
 * (portuguese/english) usáveis. NÃO constrói FTS de verdade (colunas tsvector /
 * índices GIN/HNSW são de #3/#6/#14) — só exercita as peças no banco real.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('fundação: extensões + FTS por idioma no Postgres descartável', () => {
  it('unaccent funciona (açúcar → acucar)', async () => {
    const [row] = await sql<{ v: string }[]>`select unaccent('açúcar') as v`
    expect(row.v).toBe('acucar')
  })

  it('FTS portuguese e english produzem tsvector', async () => {
    const [pt] = await sql<{ v: string }[]>`select to_tsvector('portuguese', 'arroz e feijão')::text as v`
    expect(pt.v.length).toBeGreaterThan(0)
    const [en] = await sql<{ v: string }[]>`select to_tsvector('english', 'rice and beans')::text as v`
    expect(en.v.length).toBeGreaterThan(0)
  })

  it('pgvector aceita o tipo vector', async () => {
    const [row] = await sql<{ v: string }[]>`select '[1,2,3]'::vector::text as v`
    expect(row.v).toBe('[1,2,3]')
  })

  it('extensões unaccent e vector estão registradas', async () => {
    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('unaccent', 'vector') order by extname
    `
    expect(rows.map((r) => r.extname)).toEqual(['unaccent', 'vector'])
  })
})

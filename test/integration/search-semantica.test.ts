import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'

/**
 * Camada semântica + fusão híbrida (issue #14, ADR-0008) pela porta MAIS ALTA — handler
 * GET de `/api/search`. Tiering ESTRITO (precisa floor) + expansão semântica por cosseno
 * (pgvector, HNSW, vector_cosine_ops). Cada teste injeta um `FakeEmbedder(1536, impl)`
 * determinístico (sem injeção → `RealEmbedder` lança → degradação só-precisa).
 *
 * O vetor-consulta e os vetores semeados são unit-vectors 1536-dim PINADOS (eK = base
 * canônica), com cossenos auditáveis vs a query. O bind de vetor em SQL usa o LITERAL
 * pgvector `'[...]'` (NÃO `sql.param(number[])` — o micro-spike provou que postgres-js
 * serializa `number[]` como array PG `{...}` e o cast `::vector` falha).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Vetores-âncora 1536-dim (eK = base canônica) ────────────────────────────────
const DIM = 1536

/** Vetor unitário no plano e1–e2 com cosseno EXATO `c` vs a query (= e1). */
function vecCos(c: number): number[] {
  const v = new Array<number>(DIM).fill(0)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}
/** Vetor da consulta: e1 (todas as consultas embedam pra cá). */
const QUERY_VEC = (() => {
  const v = new Array<number>(DIM).fill(0)
  v[0] = 1
  return v
})()
/** Literal pgvector `'[...]'` (o bind que o micro-spike provou funcionar). */
const lit = (v: number[]): string => '[' + v.join(',') + ']'

describe('camada semântica #14 — migração + índice HNSW', () => {
  it('AC (índice): EXPLAIN do <=> usa recipe_embedding_embedding_hnsw', async () => {
    // Semeia algumas linhas com embedding não-nulo (o índice é PARCIAL: WHERE NOT NULL).
    const ids: string[] = []
    for (const c of [0.9, 0.8, 0.5, 0.2]) {
      const [rec] = await sql<{ id: string }[]>`
        INSERT INTO recipe (origin, original_locale, owner_id, visibility, result_kind)
        VALUES ('catalog','pt-BR',NULL,'private','success') RETURNING id
      `
      await sql`
        INSERT INTO recipe_embedding (recipe_id, locale, embedding, model, stale)
        VALUES (${rec.id}, 'pt-BR', ${lit(vecCos(c))}::vector, 'fake-deterministic', false)
      `
      ids.push(rec.id)
    }

    // Tabela minúscula ⇒ o planner preferiria seq-scan; SET LOCAL força o índice DENTRO
    // de uma transação (makeSql é pooled, max:10 ⇒ sql.begin reserva 1 conn, senão
    // UNSAFE_TRANSACTION). O literal é o vetor-consulta SERIALIZADO de 1536 dims (um
    // literal de dimensão errada erraria `expected 1536 dimensions`).
    const planJson = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      const plan = await tx<{ 'QUERY PLAN': unknown[] }[]>`
        EXPLAIN (FORMAT JSON)
        SELECT recipe_id FROM recipe_embedding
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${lit(QUERY_VEC)}::vector
        LIMIT 5
      `
      return JSON.stringify(plan)
    })

    expect(planJson).toContain('recipe_embedding_embedding_hnsw')

    for (const id of ids) await sql`DELETE FROM recipe WHERE id = ${id}`
  })
})

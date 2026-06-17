import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder, ThrowingEmbedder } from '@/server/embedding/embedder'
import { embedTranslation, EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { searchRecipes } from '@/server/recipe/search'
import { recipeEmbedding } from '@/db/schema'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'

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

describe('camada semântica #14 — recompute (embedTranslation)', () => {
  it('AC6: embeda a Tradução corrente (titulo+descricao) e grava model', async () => {
    setEmbedder(new FakeEmbedder(DIM, () => vecCos(0.8)))
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      descricao: 'Ensopado de feijão-preto.',
      provenance: 'escrita_por_pessoa',
    })
    // sem seedEmbedding: a linha de embedding NÃO existe ainda (1º embedding via upsert).

    const res = await embedTranslation(db, recipeId, 'pt-BR')
    expect(res).toEqual({ ok: true })

    const [row] = await db
      .select({
        model: recipeEmbedding.model,
        stale: recipeEmbedding.stale,
        dims: dsql`array_length(${recipeEmbedding.embedding}::real[], 1)`.mapWith(Number),
      })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(row.model).toBe(EMBEDDING_MODEL)
    expect(row.dims).toBe(DIM)
    expect(row.stale).toBe(false)
  })

  it('AC6 (sem tradução): embedTranslation devolve ok:false e não cria embedding', async () => {
    setEmbedder(new FakeEmbedder(DIM, () => vecCos(0.8)))
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    // sem seedTranslation no locale pedido
    const res = await embedTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ ok: false })
    const rows = await db
      .select({ locale: recipeEmbedding.locale })
      .from(recipeEmbedding)
      .where(eq(recipeEmbedding.recipeId, recipeId))
    expect(rows).toHaveLength(0)
  })

  it('AC7 (feliz): stale=true → recompute → vetor recomputado + stale=false', async () => {
    setEmbedder(new FakeEmbedder(DIM, () => vecCos(0.9)))
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de cenoura',
      provenance: 'escrita_por_pessoa',
    })
    // embedding velho (cosseno fraco) marcado stale, como #3 faria.
    await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(0.1), model: 'old', stale: true })

    const res = await embedTranslation(db, recipeId, 'pt-BR')
    expect(res).toEqual({ ok: true })

    const [row] = await db
      .select({
        stale: recipeEmbedding.stale,
        model: recipeEmbedding.model,
        // cosseno do vetor recomputado vs e1 (esperado ~0.9 do FakeEmbedder novo).
        cos: dsql`1 - (${recipeEmbedding.embedding} <=> ${lit(QUERY_VEC)}::vector)`.mapWith(Number),
      })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(row.stale).toBe(false)
    expect(row.model).toBe(EMBEDDING_MODEL)
    expect(row.cos).toBeCloseTo(0.9, 4) // recomputado (era ~0.1)
  })

  it('AC7 (falha NÃO limpa): embedder lança → propaga, stale fica true, vetor intacto', async () => {
    setEmbedder(new ThrowingEmbedder())
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pão de queijo',
      provenance: 'escrita_por_pessoa',
    })
    await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(0.1), model: 'old', stale: true })

    await expect(embedTranslation(db, recipeId, 'pt-BR')).rejects.toThrow()

    const [row] = await db
      .select({
        stale: recipeEmbedding.stale,
        model: recipeEmbedding.model,
        cos: dsql`1 - (${recipeEmbedding.embedding} <=> ${lit(QUERY_VEC)}::vector)`.mapWith(Number),
      })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(row.stale).toBe(true) // sinal preservado pra retry
    expect(row.model).toBe('old') // não tocado
    expect(row.cos).toBeCloseTo(0.1, 4) // vetor intacto
  })
})

describe('camada semântica #14 — fusão híbrida no loader (Fork A)', () => {
  // Helper: catálogo com título dado + embedding de cosseno `cos` vs a query (e1).
  async function seedCatalogWithEmbedding(titulo: string, cos: number | null): Promise<string> {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
    if (cos !== null) {
      await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(cos), model: EMBEDDING_MODEL })
    }
    return recipeId
  }

  function indexOf(hits: { recipe_id: string }[], id: string): number {
    return hits.findIndex((h) => h.recipe_id === id)
  }

  it('AC2: piso da precisa — A (exato, cosseno fraco) ACIMA de B (só-semântico, cosseno forte)', async () => {
    const db = getDb()
    // A: título casa "Bolo" (FTS hit, bucket 1) mas cosseno FRACO (0.20).
    const A = await seedCatalogWithEmbedding('Bolo de fubá', 0.2)
    // B: título SEM "Bolo" (zero FTS) mas cosseno FORTE (0.90) — só-semântico, bucket 2.
    const B = await seedCatalogWithEmbedding('Torta de limão', 0.9)

    // Controle negativo OBSERVÁVEL (S5): cos(B) > cos(A) via SQL cru, ANTES da asserção de
    // ordem — prova que B é semanticamente mais perto e MESMO ASSIM A vem primeiro.
    const [{ cosA }] = await sql<{ cosA: number }[]>`
      SELECT 1 - (embedding <=> ${lit(QUERY_VEC)}::vector) AS "cosA"
      FROM recipe_embedding WHERE recipe_id = ${A}`
    const [{ cosB }] = await sql<{ cosB: number }[]>`
      SELECT 1 - (embedding <=> ${lit(QUERY_VEC)}::vector) AS "cosB"
      FROM recipe_embedding WHERE recipe_id = ${B}`
    expect(Number(cosB)).toBeGreaterThan(Number(cosA))

    const { hits, sugestoes } = await searchRecipes(db, {
      q: 'Bolo',
      terms: ['Bolo'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
    })
    const iA = indexOf(hits, A)
    const iB = indexOf(hits, B)
    expect(iA).toBeGreaterThanOrEqual(0) // A presente (bucket 1)
    expect(iB).toBeGreaterThanOrEqual(0) // B presente (bucket 2, mesma seção catálogo)
    expect(iA).toBeLessThan(iB) // piso da precisa: A ACIMA de B, apesar do cosseno
    // Solda omissão (O1): há precisa ⇒ sem sugestões (chave omitida no DTO).
    expect(sugestoes).toEqual([])
  })

  it('AC1: desempate por cosseno LOAD-BEARING dentro do bucket 1 (M2)', async () => {
    const db = getDb()
    // Dois hits de precisa na MESMA seção, sinal de precisa IDÊNTICO (só title_match de
    // "Sopa"), cossenos diferentes 0.70 vs 0.50 → só a 3ª chave (cosine_sim DESC) desempata.
    const HI = await seedCatalogWithEmbedding('Sopa de tomate', 0.7)
    const LO = await seedCatalogWithEmbedding('Sopa de cebola', 0.5)

    const { hits } = await searchRecipes(db, {
      q: 'Sopa',
      terms: ['Sopa'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
    })
    const iHi = indexOf(hits, HI)
    const iLo = indexOf(hits, LO)
    expect(iHi).toBeGreaterThanOrEqual(0)
    expect(iLo).toBeGreaterThanOrEqual(0)
    // Chaves 1 e 2 empatam ⇒ a asserção só passa se cosine_sim DESC estiver viva.
    expect(iHi).toBeLessThan(iLo)
  })

  it('AC: degradação no loader (queryVector=null) ⇒ sem sugestões, só precisa', async () => {
    const db = getDb()
    const A = await seedCatalogWithEmbedding('Bolo de fubá', 0.2)
    await seedCatalogWithEmbedding('Torta de limão', 0.9) // só-semântico: sem queryVector, não entra

    const { hits, sugestoes } = await searchRecipes(db, {
      q: 'Bolo',
      terms: ['Bolo'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
    })
    expect(indexOf(hits, A)).toBeGreaterThanOrEqual(0)
    expect(hits).toHaveLength(1) // só o hit de precisa; bucket 2 elidido
    expect(sugestoes).toEqual([])
  })
})

import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setEmbedder, resetDeps } from '@/server/deps'
import { FakeEmbedder, ThrowingEmbedder } from '@/server/embedding/embedder'
import { embedTranslation, EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { searchRecipes } from '@/server/recipe/search'
import { GET } from '@/app/api/search/route'
import { recipeEmbedding } from '@/db/schema'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: string
  autoTranslationSignal: boolean
}
type SearchResponse = {
  minhas: SearchResult[]
  catalogo: SearchResult[]
  comunidade: SearchResult[]
  sugestoes?: SearchResult[]
}

/** Busca pela porta MAIS ALTA (GET cru). Sem headers = Visitante anônimo. */
async function searchBody(q: string, locale = 'pt-BR'): Promise<{ status: number; body: SearchResponse }> {
  const params = new URLSearchParams({ q, locale })
  const res = await GET(new Request(`http://localhost/api/search?${params.toString()}`))
  return { status: res.status, body: (await res.json()) as SearchResponse }
}
const sugIds = (b: SearchResponse): string[] => (b.sugestoes ?? []).map((r) => r.recipeId)
const secIds = (b: SearchResponse): string[] =>
  [...b.minhas, ...b.catalogo, ...b.comunidade].map((r) => r.recipeId)

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
        VALUES (${rec.id}, 'pt-BR', ${lit(vecCos(c))}::vector, ${EMBEDDING_MODEL}, false)
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
  // Helper: catálogo com título dado + embedding de cosseno `cos` vs a query (e1). `id`
  // opcional pina o PK (p/ ordenar tiebreaks deterministicamente — O4).
  async function seedCatalogWithEmbedding(
    titulo: string,
    cos: number | null,
    id?: string,
  ): Promise<string> {
    const recipeId = await seedRecipe({ id, origin: 'catalog', originalLocale: 'pt-BR' })
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
    // O4 (determinismo): pinamos os PKs de forma que LO.id < HI.id lexicalmente. Assim o
    // último tiebreak `recipe_id` (ASC) colocaria LO ACIMA de HI — o OPOSTO do esperado.
    // Logo, se a chave `cosine_sim DESC` for DROPADA, a ordem cai pra recipe_id e a asserção
    // `iHi < iLo` falha DETERMINISTICAMENTE (não ~50% como com UUIDs aleatórios).
    const HI_ID = '00000000-0000-4000-8000-0000000000b2' // > LO_ID
    const LO_ID = '00000000-0000-4000-8000-0000000000a1' // < HI_ID
    const HI = await seedCatalogWithEmbedding('Sopa de tomate', 0.7, HI_ID)
    const LO = await seedCatalogWithEmbedding('Sopa de cebola', 0.5, LO_ID)

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
    // Chaves 1 e 2 empatam; recipe_id (LO < HI) ordenaria LO acima ⇒ a asserção só passa se
    // cosine_sim DESC estiver viva (HI cos 0.70 > LO cos 0.50).
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

describe('camada semântica #14 — porta alta (AC3/AC4/AC5)', () => {
  // Embedder que mapeia QUALQUER consulta ao vetor e1 (QUERY_VEC): os cossenos vs os
  // embeddings semeados são auditáveis e determinísticos. O título de busca NÃO casa
  // léxico em nenhum fixture (US37/US38), então não há precisa via FTS.
  function injectQueryEmbedder(): void {
    setEmbedder(new FakeEmbedder(DIM, () => QUERY_VEC))
  }
  async function seedNeighbor(titulo: string, cos: number, locale = 'pt-BR'): Promise<string> {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: locale })
    await seedTranslation({ recipeId, locale, titulo, provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId, locale, embedding: vecCos(cos), model: EMBEDDING_MODEL })
    return recipeId
  }

  it('AC3(a) US38: busca sem precisa COM vizinho ⇒ sugestoes PRESENTE; seções vazias', async () => {
    injectQueryEmbedder()
    const SN = await seedNeighbor('Risoto de funghi', 0.85) // cosseno forte, sem casar "xyzzy"
    const { status, body } = await searchBody('xyzzy')
    expect(status).toBe(200)
    expect(secIds(body)).toHaveLength(0) // nenhuma precisa ⇒ seções vazias
    expect('sugestoes' in body).toBe(true)
    expect(sugIds(body)).toContain(SN)
  })

  it('AC3(b) discriminação do limiar 0.50: SM_above incluído, SM_below excluído', async () => {
    injectQueryEmbedder()
    const above = await seedNeighbor('Bobó de camarão', 0.6) // > 0.50
    const below = await seedNeighbor('Moqueca baiana', 0.4) // < 0.50
    const { body } = await searchBody('qwerty')
    expect(sugIds(body)).toContain(above)
    expect(sugIds(body)).not.toContain(below)
  })

  it('AC3(b) US37 puro: tudo abaixo do limiar ⇒ sugestoes OMITIDA', async () => {
    injectQueryEmbedder()
    await seedNeighbor('Curau de milho', 0.4) // < 0.50
    await seedNeighbor('Pamonha', 0.0) // ortogonal
    const { body } = await searchBody('zxcvb')
    expect(secIds(body)).toHaveLength(0)
    expect('sugestoes' in body).toBe(false) // chave OMITIDA (não [])
  })

  it('AC3(c) com precisa: só-semânticos viram bucket 2 nas seções; sugestoes OMITIDA', async () => {
    injectQueryEmbedder()
    // "Sopa" casa o título (precisa) + cosseno fraco; vizinho forte sem casar.
    const P = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: P, locale: 'pt-BR', titulo: 'Sopa de mandioca', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: P, locale: 'pt-BR', embedding: vecCos(0.2), model: EMBEDDING_MODEL })
    const N = await seedNeighbor('Caldo verde', 0.9) // só-semântico forte
    const { body } = await searchBody('Sopa')
    expect(secIds(body)).toContain(P) // precisa, bucket 1
    expect(secIds(body)).toContain(N) // só-semântico, bucket 2 (mesma seção)
    expect('sugestoes' in body).toBe(false) // chave OMITIDA (há precisa)
  })

  it('AC4 degradação: ThrowingEmbedder ≡ sem-embedder, 200, conjunto = só-precisa, não-vazio', async () => {
    // Semeia precisa via título + um só-semântico forte (que NÃO deve aparecer degradado).
    const P = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: P, locale: 'pt-BR', titulo: 'Bolo de milho', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: P, locale: 'pt-BR', embedding: vecCos(0.2), model: EMBEDDING_MODEL })
    await seedNeighbor('Pudim de leite', 0.95)

    // (i) ThrowingEmbedder: embed lança ⇒ queryVector=null ⇒ degradação.
    setEmbedder(new ThrowingEmbedder())
    const throwing = await searchBody('Bolo')

    // (ii) Sem embedder injetado ⇒ default RealEmbedder ⇒ embed lança ⇒ MESMO caminho de
    // degradação, sobre os MESMOS dados (mesmo banco, sem truncate dentro do teste).
    resetDeps()
    const def = await searchBody('Bolo')

    expect(throwing.status).toBe(200)
    expect(def.status).toBe(200)
    expect(throwing.body).toEqual(def.body) // mesmo caminho de degradação
    // NÃO-vácuo: contém o hit de precisa semeado.
    expect(secIds(throwing.body)).toContain(P)
    // O só-semântico forte NÃO aparece (degradado: sem camada semântica).
    expect('sugestoes' in throwing.body).toBe(false)
  })

  it('AC5 (sugestões): fallback de locale — embedding só em locale ≠ pedido ainda alcança', async () => {
    injectQueryEmbedder()
    // Tradução + embedding SÓ em en-US; busca em pt-BR ainda alcança via fallback.
    const SL = await seedRecipe({ origin: 'catalog', originalLocale: 'en-US' })
    await seedTranslation({ recipeId: SL, locale: 'en-US', titulo: 'Mushroom Risotto', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: SL, locale: 'en-US', embedding: vecCos(0.85), model: EMBEDDING_MODEL })
    const { body } = await searchBody('asdfg', 'pt-BR')
    expect(sugIds(body)).toContain(SL) // alcançada por fallback de locale
  })

  it('AC5 (prioridade requestLocale, O3): a chave de locale do DISTINCT ON é LOAD-BEARING', async () => {
    injectQueryEmbedder()
    // Receita com DOIS embeddings CRUZANDO o limiar 0.50: pt-BR (requestLocale) cos 0.40
    // (ABAIXO) e en-US cos 0.95 (ACIMA). A chave `(re.locale = requestLocale) DESC` do
    // DISTINCT ON faz a CTE escolher a linha pt-BR (0.40 < 0.50) ⇒ R é EXCLUÍDA de
    // sugestoes. Se essa chave fosse REMOVIDA, o DISTINCT ON cairia no menor distância
    // (en-US 0.95) e R apareceria ERRADAMENTE ⇒ a asserção falha na mutação da chave.
    const R = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: R, locale: 'pt-BR', titulo: 'Quindim', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId: R, locale: 'en-US', titulo: 'Coconut Custard', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: R, locale: 'pt-BR', embedding: vecCos(0.4), model: EMBEDDING_MODEL })
    await seedEmbedding({ recipeId: R, locale: 'en-US', embedding: vecCos(0.95), model: EMBEDDING_MODEL })

    // Controle: um vizinho pt-BR forte garante que sugestoes ESTÁ presente (a asserção de
    // exclusão de R não é vácua por ausência total de sugestões).
    const NB = await seedNeighbor('Brigadeiro', 0.9)

    const { body } = await searchBody('hjkl', 'pt-BR')
    expect(secIds(body)).toHaveLength(0) // sem precisa ⇒ seções vazias
    expect(sugIds(body)).toContain(NB) // sugestoes presente (controle não-vácuo)
    // R EXCLUÍDA: o DISTINCT ON pegou a linha pt-BR (0.40 < 0.50), via a chave de locale.
    // Sem essa chave, pegaria en-US (0.95) e R apareceria — esta asserção quebra na mutação.
    expect(sugIds(body)).not.toContain(R)
  })

  it('AC5 (bucket-1, O2): fallback de locale dirige o cosseno no ramo COM precisa', async () => {
    injectQueryEmbedder()
    // Hit de precisa em pt-BR (título casa "Pizza"), mas embedding SÓ em en-US (cos 0.7).
    const SF = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: SF, locale: 'pt-BR', titulo: 'Pizza margherita', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: SF, locale: 'en-US', embedding: vecCos(0.7), model: EMBEDDING_MODEL })

    const { hits } = await searchRecipes(getDb(), {
      q: 'Pizza',
      terms: ['Pizza'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
    })
    // O hit aparece (precisa). Seu cosseno no bucket 1 vem do fallback (≠ 0): provamos via
    // query crua espelhando a CTE (sem embedding no requestLocale, cai pro en-US).
    expect(hits.map((h) => h.recipe_id)).toContain(SF)
    const [{ cos }] = await sql<{ cos: number }[]>`
      SELECT 1 - (embedding <=> ${lit(QUERY_VEC)}::vector) AS cos
      FROM recipe_embedding WHERE recipe_id = ${SF}`
    expect(Number(cos)).toBeCloseTo(0.7, 4) // fallback de locale ⇒ cosseno ≠ 0
  })

  it('M1: precisa só-PRIVADA (gated-out) ⇒ vizinho público vai pra sugestoes, não pra seção', async () => {
    injectQueryEmbedder()
    const ownerId = await seedUser({ email: `m1-owner-${crypto.randomUUID()}@ex.com` })
    // Receita PRIVADA do dono cujo TÍTULO casa "Segredo" (combined não-vazio ANTES do gate),
    // mas barrada pelo gate canônico (visibility=private + owner_id) ⇒ NÃO aparece.
    const PRIV = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId,
    })
    await seedTranslation({ recipeId: PRIV, locale: 'pt-BR', titulo: 'Segredo da casa', provenance: 'escrita_por_pessoa' })
    // Vizinho PÚBLICO de catálogo, cosseno forte, título SEM casar "Segredo".
    const NB = await seedNeighbor('Brigadeiro de colher', 0.9)

    const { status, body } = await searchBody('Segredo', 'pt-BR')
    expect(status).toBe(200)
    // Sem precisa VISÍVEL ⇒ seções vazias; a única precisa (PRIV) é gated-out.
    expect(secIds(body)).toHaveLength(0)
    expect(secIds(body)).not.toContain(PRIV) // privada nunca vaza
    // O vizinho vai pra sugestoes (US38), não pra uma seção (M1: bucket 2 não ativou porque
    // a precisa visível é zero).
    expect('sugestoes' in body).toBe(true)
    expect(sugIds(body)).toContain(NB)
    expect(secIds(body)).not.toContain(NB)
  })

  it('S1: embedder com saída MALFORMADA (não-finita / dimensão errada) ⇒ 200 + só-precisa', async () => {
    // Precisa via título "Bolo" + um vizinho forte que NÃO deve aparecer se degradar.
    const P = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: P, locale: 'pt-BR', titulo: 'Bolo de laranja', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: P, locale: 'pt-BR', embedding: vecCos(0.2), model: EMBEDDING_MODEL })
    await seedNeighbor('Mousse de maracujá', 0.95)

    // (i) Vetor com elemento NÃO-FINITO (NaN) — bindado cru, o cast ::vector estouraria 500.
    const nan = vecCos(0.9)
    nan[0] = NaN
    setEmbedder(new FakeEmbedder(DIM, () => nan))
    const a = await searchBody('Bolo')
    expect(a.status).toBe(200) // degradou (não 500)
    expect(secIds(a.body)).toContain(P) // só-precisa
    expect('sugestoes' in a.body).toBe(false) // sem camada semântica

    // (ii) Vetor de DIMENSÃO errada (não 1536).
    resetDeps()
    setEmbedder(new FakeEmbedder(DIM, () => [1, 0, 0]))
    const b = await searchBody('Bolo')
    expect(b.status).toBe(200)
    expect(secIds(b.body)).toContain(P)
    expect('sugestoes' in b.body).toBe(false)
  })

  it('S2: embedding de norma-zero (cosseno NaN) NÃO ranqueia acima de um match genuíno', async () => {
    injectQueryEmbedder()
    // Vizinho de NORMA-ZERO: cosseno = 1 - (vetor <=> query) = NaN. Sem o filtro
    // `s.cosine_sim = s.cosine_sim`, NaN passaria o limiar E ordenaria PRIMEIRO (Postgres
    // ranqueia NaN acima de todo finito) sob cosine_sim DESC.
    const ZERO = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId: ZERO, locale: 'pt-BR', titulo: 'Item ruidoso', provenance: 'escrita_por_pessoa' })
    await seedEmbedding({ recipeId: ZERO, locale: 'pt-BR', embedding: new Array<number>(DIM).fill(0), model: EMBEDDING_MODEL })
    // Match genuíno forte.
    const GOOD = await seedNeighbor('Pavê de chocolate', 0.9)

    const { body } = await searchBody('lkjhg')
    const sug = sugIds(body)
    expect(sug).toContain(GOOD) // o match genuíno aparece
    expect(sug).not.toContain(ZERO) // o norma-zero (NaN) é filtrado
    // E NUNCA ranqueia acima do match genuíno (defensivo, caso ambos passassem).
    expect(sug[0]).toBe(GOOD)
  })
})

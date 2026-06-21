import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { POST } from '@/app/api/admin/embeddings/recompute/route'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder, ThrowingEmbedder } from '@/server/embedding/embedder'
import { EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { recipeEmbedding } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedEmbedding } from '../helpers/recipes'

/**
 * Backfill de embeddings (#119) — `POST /api/admin/embeddings/recompute` ADMIN-ONLY. Recomputa, em
 * lote capado e RETOMÁVEL, as Traduções sem vetor válido. Pela porta mais alta com `FakeEmbedder`
 * (nunca toca o Gemini). Cobre: gate de papel; recompute + idempotência; clamp de `limit`; degradação
 * do embedder (para no 1º erro, reporta `error` + `remaining`); embedding válido NÃO é recandidato.
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function recompute(headers?: Headers, limit?: number): Promise<Response> {
  const qs = limit != null ? `?limit=${limit}` : ''
  return POST(new Request(`http://localhost/api/admin/embeddings/recompute${qs}`, { method: 'POST', headers }))
}

/** Receita do usuário SEM embedding (como nasce antes do pipeline) — um candidato ao backfill. */
async function seedRecipeNoEmbedding(titulo: string): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  return id
}
async function hasVector(recipeId: string): Promise<boolean> {
  const [e] = await getDb()
    .select({ dims: dsql`array_length(${recipeEmbedding.embedding}::real[], 1)`.mapWith(Number) })
    .from(recipeEmbedding)
    .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'pt-BR')))
  return e?.dims === EMBEDDING_DIMENSIONS
}
type Body = { recomputed: number; remaining: number; error?: string }

describe('POST /api/admin/embeddings/recompute — backfill (#119)', () => {
  it('gate de papel: anon 401, usuario/curador 403, admin 200', async () => {
    const { headers: usuarioH } = await seedSessionHeaders({ email: 'bf-user@ex.com', role: 'usuario' })
    const { headers: curadorH } = await seedSessionHeaders({ email: 'bf-cur@ex.com', role: 'curador' })
    const { headers: adminH } = await seedSessionHeaders({ email: 'bf-admin@ex.com', role: 'admin' })
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))

    expect((await recompute()).status).toBe(401)
    expect((await recompute(usuarioH)).status).toBe(403)
    expect((await recompute(curadorH)).status).toBe(403)
    expect((await recompute(adminH)).status).toBe(200)
  })

  it('recomputa os candidatos + idempotente (2ª chamada não tem o que fazer)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'bf-run@ex.com', role: 'admin' })
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))
    const a = await seedRecipeNoEmbedding('Ovos mexidos cremosos')
    const b = await seedRecipeNoEmbedding('Panqueca de banana')
    const c = await seedRecipeNoEmbedding('Sopa de abóbora')

    const r1 = (await (await recompute(headers)).json()) as Body
    expect(r1.recomputed).toBe(3)
    expect(r1.remaining).toBe(0)
    expect(await hasVector(a)).toBe(true)
    expect(await hasVector(b)).toBe(true)
    expect(await hasVector(c)).toBe(true)

    // Idempotente: nada mais a fazer.
    const r2 = (await (await recompute(headers)).json()) as Body
    expect(r2.recomputed).toBe(0)
    expect(r2.remaining).toBe(0)
  })

  it('limit capa o lote e `remaining` guia a retomada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'bf-limit@ex.com', role: 'admin' })
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))
    await seedRecipeNoEmbedding('R1')
    await seedRecipeNoEmbedding('R2')
    await seedRecipeNoEmbedding('R3')

    const r1 = (await (await recompute(headers, 2)).json()) as Body
    expect(r1.recomputed).toBe(2)
    expect(r1.remaining).toBe(1)

    const r2 = (await (await recompute(headers, 2)).json()) as Body
    expect(r2.recomputed).toBe(1)
    expect(r2.remaining).toBe(0)
  })

  it('embedder indisponível (Throwing): para no 1º erro, recomputed=0, remaining intacto + error', async () => {
    const { headers } = await seedSessionHeaders({ email: 'bf-throw@ex.com', role: 'admin' })
    setEmbedder(new ThrowingEmbedder())
    await seedRecipeNoEmbedding('X1')
    await seedRecipeNoEmbedding('X2')

    const r = (await (await recompute(headers)).json()) as Body
    expect(r.recomputed).toBe(0)
    expect(r.remaining).toBe(2) // nada feito — o admin retoma quando a key/limite resolver
    expect(r.error).toBeTruthy()
  })

  it('embedding VÁLIDO já existente NÃO é recandidato (só o que falta é recomputado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'bf-existing@ex.com', role: 'admin' })
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))
    const jaTem = await seedRecipeNoEmbedding('Já vetorizada')
    await seedEmbedding({
      recipeId: jaTem,
      locale: 'pt-BR',
      embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1),
      model: EMBEDDING_MODEL,
      stale: false,
    })
    const falta = await seedRecipeNoEmbedding('Falta vetor')

    const r = (await (await recompute(headers)).json()) as Body
    expect(r.recomputed).toBe(1) // só `falta`
    expect(r.remaining).toBe(0)
    expect(await hasVector(falta)).toBe(true)

    // E o vetor JÁ existente fica INTOCADO (não foi re-embedado): o 1º componente segue 0.1
    // (o FakeEmbedder produziria outro valor — prova que o backfill não recomputou um válido).
    const [e] = await getDb()
      .select({ first: dsql`(${recipeEmbedding.embedding}::real[])[1]`.mapWith(Number) })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, jaTem), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(e.first).toBeCloseTo(0.1)
  })
})

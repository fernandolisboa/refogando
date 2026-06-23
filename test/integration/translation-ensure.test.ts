import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import {
  FakeTranslator,
  ThrowingTranslator,
  type Translator,
  type TranslateInput,
  type TranslateOutput,
} from '@/server/translation/translator'
import { FakeEmbedder, ThrowingEmbedder, type Embedder } from '@/server/embedding/embedder'
import { EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { ensureTranslation } from '@/server/recipe/translation'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Serviço `ensureTranslation` (issue #23, C2) — AC1 (1º acesso gera tradução sinalizada
 * + embedding) e AC4 (falha na geração ⇒ ZERO escrita, degrada). MICRO-SPIKE do ponto
 * mais arriscado: a integração linha-do-2º-locale → embedTranslation (de #14) → ler o
 * embedding de volta com `array_length(embedding::real[],1) === 1536`. `FakeEmbedder(1536)`
 * SEMPRE (default 8 dims quebraria vector(1536)). Modelo: search-semantica.test.ts:133-144.
 */

const DIM = 1536

/** Translator-spy: conta chamadas e delega ao FakeTranslator (identidade). */
class CountingTranslator implements Translator {
  calls = 0
  private readonly inner = new FakeTranslator()
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    this.calls++
    return this.inner.translate(input)
  }
}

/** Embedder-spy: conta chamadas e delega ao FakeEmbedder(1536). */
class CountingEmbedder implements Embedder {
  calls = 0
  private readonly inner = new FakeEmbedder(DIM)
  async embed(text: string): Promise<number[]> {
    this.calls++
    return this.inner.embed(text)
  }
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Receita catálogo com SÓ a tradução de origem pt-BR (sem o 2º locale ainda). */
async function seedOriginOnly(): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Feijoada',
    descricao: 'Ensopado de feijão-preto.',
    provenance: 'escrita_por_pessoa',
  })
  return recipeId
}

describe('ensureTranslation #23 — AC1 (gera 2º locale sinalizado + embedding)', () => {
  it('1º acesso cria linha automatica_nao_revisada + embedding 1536-dim; origem intocada', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly()

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'created' })

    // Linha en-US nasce sinalizada (não revisada), não-stale.
    const [en] = await db
      .select({ provenance: recipeTranslation.provenance, stale: recipeTranslation.stale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(en.provenance).toBe('automatica_nao_revisada')
    expect(en.stale).toBe(false)

    // Embedding en-US populado 1536-dim (array_length cru — embedding é nullable).
    const [emb] = await db
      .select({
        model: recipeEmbedding.model,
        stale: recipeEmbedding.stale,
        dims: dsql`array_length(${recipeEmbedding.embedding}::real[], 1)`.mapWith(Number),
      })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'en-US')))
    expect(emb.model).toBe(EMBEDDING_MODEL)
    expect(emb.dims).toBe(DIM)
    expect(emb.stale).toBe(false)

    // Origem pt-BR INTOCADA (proveniência/conteúdo).
    const [pt] = await db
      .select({ provenance: recipeTranslation.provenance, titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'pt-BR')))
    expect(pt.provenance).toBe('escrita_por_pessoa')
    expect(pt.titulo).toBe('Feijoada')
  })

  it('idempotente: 2× não duplica, e o 2º acesso NÃO re-traduz nem re-embeda', async () => {
    const translator = new CountingTranslator()
    const embedder = new CountingEmbedder()
    setTranslator(translator)
    setEmbedder(embedder)
    const db = getDb()
    const recipeId = await seedOriginOnly()

    const first = await ensureTranslation(db, recipeId, 'en-US')
    expect(first).toEqual({ kind: 'created' })
    // Contagens após o 1º acesso (1 translate + 1 embed).
    const translatesAfterFirst = translator.calls
    const embedsAfterFirst = embedder.calls
    expect(translatesAfterFirst).toBe(1)
    expect(embedsAfterFirst).toBe(1)

    const second = await ensureTranslation(db, recipeId, 'en-US')
    expect(second).toEqual({ kind: 'exists' })

    // LOAD-BEARING (early-exit "2º locale já existe"): o 2º acesso adiciona ZERO
    // translate() e ZERO embed(). Sem o early-exit, ambos seriam chamados de novo
    // (insert idempotente e embed idempotente mascarariam o re-trabalho nas outras
    // asserções — só a contagem expõe o gasto).
    expect(translator.calls).toBe(translatesAfterFirst) // +0 traduções
    expect(embedder.calls).toBe(embedsAfterFirst) // +0 embeddings

    const rows = await db
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(rows).toHaveLength(1)
  })
})

describe('ensureTranslation — Slug por idioma (#229, ADR-0020 dec.4: congela da MT INICIAL)', () => {
  it('a tradução en-US nasce JÁ com slug, derivado do título da MT — não fica NULL esperando backfill', async () => {
    // MT que devolve um título en-US DISTINTO do pt-BR: prova que o slug vem do título da
    // tradução-máquina (en-US), não do título de origem (pt-BR).
    setTranslator(new FakeTranslator({ titulo: 'Carrot Cake', descricao: null, passos: null, notas: null }))
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly() // pt-BR "Feijoada"

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'created' })

    const [en] = await db
      .select({ slug: recipeTranslation.slug, titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(en.titulo).toBe('Carrot Cake')
    // Slug materializado NA ESCRITA (write-path), congelado a partir do título da MT inicial.
    expect(en.slug).toBe('carrot-cake')
  })

  it('dois en-US com o MESMO título de MT ⇒ slugs DISTINTOS (desambiguação por locale na borda)', async () => {
    setTranslator(new FakeTranslator({ titulo: 'Carrot Cake', descricao: null, passos: null, notas: null }))
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const r1 = await seedOriginOnly()
    const r2 = await seedOriginOnly()

    await ensureTranslation(db, r1, 'en-US')
    await ensureTranslation(db, r2, 'en-US')

    const slugs = await db
      .select({ recipeId: recipeTranslation.recipeId, slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.locale, 'en-US'), dsql`${recipeTranslation.titulo} = 'Carrot Cake'`))
    const mine = slugs.filter((s) => s.recipeId === r1 || s.recipeId === r2)
    expect(mine).toHaveLength(2)
    for (const s of mine) expect(s.slug).not.toBeNull()
    // O índice UNIQUE(locale, slug) teria recusado dois iguais ⇒ devem ser distintos.
    expect(new Set(mine.map((s) => s.slug)).size).toBe(2)
  })
})

describe('ensureTranslation #23 — AC4 (degradação graciosa)', () => {
  it('ThrowingTranslator ⇒ ZERO linha en-US, sem erro que aborte', async () => {
    setTranslator(new ThrowingTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const db = getDb()
    const recipeId = await seedOriginOnly()

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'degraded' })

    const rows = await db
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(rows).toHaveLength(0)
  })

  it('borda: translator OK mas embedder lança ⇒ linha PERSISTE sem embedding (created)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new ThrowingEmbedder())
    const db = getDb()
    const recipeId = await seedOriginOnly()

    const res = await ensureTranslation(db, recipeId, 'en-US')
    expect(res).toEqual({ kind: 'created' })

    // Linha traduzível persiste...
    const trs = await db
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'en-US')))
    expect(trs).toHaveLength(1)
    // ...mas sem embedding (o embedder lançou ANTES do upsert do vetor; stale intacto).
    const embs = await db
      .select({ locale: recipeEmbedding.locale })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, 'en-US')))
    expect(embs).toHaveLength(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/search/route'
import { getDb, setEmbedder } from '@/server/deps'
import { EMBEDDING_DIMENSIONS, rateLimitWindow, searchQueryEmbedding } from '@/db/schema'
import { FakeEmbedder, ThrowingEmbedder } from '@/server/embedding/embedder'
import { RATE_LIMITS } from '@/domain/rate-limit-rules'
import {
  SEARCH_QUERY_EMBEDDING_TTL_MS,
  resolveSearchQueryVector,
  searchQueryCacheKey,
} from '@/server/search/query-embedding'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Vetor da consulta de busca com cache e limitador persistido (#643, ADR-0057), pela porta alta (GET /api/search) e
 * pelo resolvedor. Prova: busca repetida (inclusive com caixa/espaços diferentes) não chama o embedder de novo; um
 * laço anônimo de buscas distintas é barrado ANTES do embedder, e a busca segue respondendo pelo FTS; o teto global
 * barra IPs variados; a pessoa logada conta pela conta, não pelo IP; o cache não guarda o texto e vence no TTL.
 */

const DIM = EMBEDDING_DIMENSIONS
const VEC = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0))

type SearchResponse = { minhas: { recipeId: string }[]; catalogo: { recipeId: string }[]; comunidade: { recipeId: string }[] }

async function search(q: string, init: { ip?: string; headers?: Headers } = {}) {
  const headers = new Headers(init.headers)
  if (init.ip) headers.set('x-real-ip', init.ip)
  const params = new URLSearchParams({ q, locale: 'pt-BR' })
  const res = await GET(new Request(`http://localhost/api/search?${params.toString()}`, { headers }))
  return { status: res.status, body: (await res.json()) as SearchResponse }
}
const ids = (b: SearchResponse) => [...b.minhas, ...b.catalogo, ...b.comunidade].map((r) => r.recipeId)

let embedder: FakeEmbedder

beforeEach(() => {
  // Relógio do app congelado no meio de uma janela: os laços abaixo não podem cruzar a virada do minuto.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:00:10.000Z'))
  embedder = new FakeEmbedder(DIM, () => VEC)
  setEmbedder(embedder)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('cache do vetor da consulta', () => {
  it('busca repetida (mesma forma canônica) chama o embedder UMA vez; o cache não guarda o texto', async () => {
    await search('Feijoada', { ip: '203.0.113.10' })
    await search('  feijoada ', { ip: '203.0.113.11' })
    await search('FEIJOADA', { ip: '203.0.113.12' })
    expect(embedder.calls).toBe(1)

    const rows = await getDb().select().from(searchQueryEmbedding)
    expect(rows).toHaveLength(1)
    expect(rows[0].queryKey).toBe(searchQueryCacheKey('feijoada'))
    expect(JSON.stringify(rows.map((r) => ({ ...r, embedding: null })))).not.toMatch(/feijoada/i)
    // Cache hit não passa pelo limitador: só a 1ª consumiu (IP + global).
    const windows = await getDb().select().from(rateLimitWindow)
    expect(windows.find((w) => w.bucket === 'search_embed_global')?.count).toBe(1)
  })

  it('embedder que falha não grava cache (a próxima tenta de novo)', async () => {
    setEmbedder(new ThrowingEmbedder())
    const r = await search('moqueca', { ip: '203.0.113.20' })
    expect(r.status).toBe(200)
    expect(await getDb().select().from(searchQueryEmbedding)).toHaveLength(0)
  })

  it('vetor vencido (TTL) não serve: o embedder é chamado de novo e a linha é renovada', async () => {
    const t0 = new Date('2026-11-02T12:00:10.000Z')
    const viewer = Promise.resolve(undefined)
    const input = { q: 'pão de queijo', ip: null, viewerId: viewer, embedder }
    expect(await resolveSearchQueryVector(getDb(), { ...input, now: t0 })).toEqual(VEC)
    expect(await resolveSearchQueryVector(getDb(), { ...input, now: new Date(t0.getTime() + SEARCH_QUERY_EMBEDDING_TTL_MS - 1000) })).toEqual(VEC)
    expect(embedder.calls).toBe(1)
    const later = new Date(t0.getTime() + SEARCH_QUERY_EMBEDDING_TTL_MS + 1000)
    expect(await resolveSearchQueryVector(getDb(), { ...input, now: later })).toEqual(VEC)
    expect(embedder.calls).toBe(2)
    const [row] = await getDb().select().from(searchQueryEmbedding)
    expect(row.createdAt.getTime()).toBe(later.getTime())
  })
})

describe('limitador do embedding', () => {
  it('laço anônimo de buscas distintas do mesmo IP: barrado antes do embedder, e a busca segue pelo FTS', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    const ip = '198.51.100.23'
    const limit = RATE_LIMITS.search_embed_ip.limit
    for (let i = 0; i < limit; i++) expect((await search(`zzqx${i}`, { ip })).status).toBe(200)
    expect(embedder.calls).toBe(limit)

    // Acima do limite: 200, o resultado textual aparece, o embedder não é chamado.
    const over = await search('feijoada', { ip })
    expect(over.status).toBe(200)
    expect(ids(over.body)).toContain(recipeId)
    expect(embedder.calls).toBe(limit)

    // Um IP diferente ainda passa (e grava o vetor, que o 1º IP não conseguiu).
    expect((await search('feijoada', { ip: '198.51.100.24' })).status).toBe(200)
    expect(embedder.calls).toBe(limit + 1)
  })

  it('IPv6 da mesma /64 dividem o limite (girar o endereço não escapa)', async () => {
    const limit = RATE_LIMITS.search_embed_ip.limit
    for (let i = 0; i < limit + 3; i++) await search(`yyq${i}`, { ip: `2001:db8:1:2::${(i + 1).toString(16)}` })
    expect(embedder.calls).toBe(limit)
  })

  it('o teto global barra um laço de IPs todos diferentes', async () => {
    const limit = RATE_LIMITS.search_embed_global.limit
    for (let i = 0; i < limit + 5; i++) await search(`wwq${i}`, { ip: `10.1.${Math.floor(i / 200)}.${i % 200}` })
    expect(embedder.calls).toBe(limit)
  })

  it('logado conta pela conta: o IP esgotado por visitantes não barra a pessoa logada', async () => {
    const ip = '192.0.2.77'
    const limit = RATE_LIMITS.search_embed_ip.limit
    for (let i = 0; i < limit; i++) await search(`vvq${i}`, { ip })
    expect(embedder.calls).toBe(limit)
    expect((await search('outra coisa', { ip })).status).toBe(200)
    expect(embedder.calls).toBe(limit) // visitante barrado

    const { headers } = await seedSessionHeaders({ email: 'busca@limite.test' })
    expect((await search('outra coisa', { ip, headers })).status).toBe(200)
    expect(embedder.calls).toBe(limit + 1)
    const buckets = (await getDb().select().from(rateLimitWindow)).map((w) => w.bucket)
    expect(buckets).toContain('search_embed_user')
  })
})

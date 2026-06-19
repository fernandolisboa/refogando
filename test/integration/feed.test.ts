import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET } from '@/app/api/feed/route'
import { seedRecipe, seedTranslation, seedRemovedFromPool } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Feed (#103) pela porta MAIS ALTA — handler GET de `/api/feed`. Lista PLANA e cronológica do
 * pool, paginada por cursor keyset. MESMO gate de leitura canônico da Busca (owner NULL OR
 * public; não-playful; não-removida). Visitante anônimo (ADR-0011). Cada AC tem ao menos um
 * controle negativo NÃO-vacuamente-verde.
 */

type FeedItem = {
  recipeId: string
  displayedTitle: string
  origin: string
  autoTranslationSignal: boolean
}
type FeedResponse = { feed: FeedItem[]; nextCursor: string | null }

function feedReq(params: Record<string, string> = {}): Promise<Response> {
  const sp = new URLSearchParams({ locale: 'pt-BR', ...params })
  return GET(new Request(`http://localhost/api/feed?${sp.toString()}`))
}

async function feedBody(params: Record<string, string> = {}): Promise<FeedResponse> {
  const res = await feedReq(params)
  expect(res.status).toBe(200)
  return (await res.json()) as FeedResponse
}

const ids = (f: FeedItem[]): string[] => f.map((i) => i.recipeId)

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Catálogo (owner NULL → sempre legível) + título + created_at EXPLÍCITO (ordenação determinística). */
async function seedAt(titulo: string, createdAt: string): Promise<string> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    resultKind: 'success',
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  await sql`UPDATE recipe SET created_at = ${createdAt}::timestamptz WHERE id = ${id}`
  return id
}

describe('GET /api/feed — feed cronológico (#103)', () => {
  it('AC1: lista o pool E aplica o gate de leitura (privada/playful/removida ausentes)', async () => {
    const owner = await seedUser({ email: 'feed-owner@test.dev' })
    const curator = await seedUser({ email: 'feed-curator@test.dev', role: 'curador' })

    const cat = await seedAt('Feijoada do Catálogo', '2026-01-01T00:00:00Z')

    // Comunidade pública (dono, public) — deve aparecer.
    const pub = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: owner,
      visibility: 'public',
      resultKind: 'success',
    })
    await seedTranslation({ recipeId: pub, locale: 'pt-BR', titulo: 'Strogonoff Público', provenance: 'escrita_por_pessoa' })

    // Privada — NÃO deve aparecer.
    const priv = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: owner,
      visibility: 'private',
      resultKind: 'success',
    })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Privada Oculta', provenance: 'escrita_por_pessoa' })

    // Playful (catálogo owner-NULL p/ ISOLAR o clause result_kind <> playful) — NÃO aparece.
    const playful = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      ownerId: null,
      visibility: 'private',
      resultKind: 'playful',
    })
    await seedTranslation({ recipeId: playful, locale: 'pt-BR', titulo: 'Zoeira do Catálogo', provenance: 'escrita_por_pessoa' })

    // Removida por moderação (era pública) — NÃO aparece.
    const removed = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: owner,
      visibility: 'public',
      resultKind: 'success',
    })
    await seedTranslation({ recipeId: removed, locale: 'pt-BR', titulo: 'Removida', provenance: 'escrita_por_pessoa' })
    await seedRemovedFromPool({ recipeId: removed, curatorId: curator })

    const body = await feedBody({ limit: '50' })
    const all = ids(body.feed)

    expect(all).toContain(cat)
    expect(all).toContain(pub)
    // Gate (controle não-vácuo): seeds existem mas FORA do feed.
    expect(all).not.toContain(priv)
    expect(all).not.toContain(playful)
    expect(all).not.toContain(removed)
  })

  it('AC2: paginação por cursor — mais recentes primeiro, sem overlap nem gap, até nextCursor=null', async () => {
    const r1 = await seedAt('Mais antiga', '2026-02-01T00:00:00Z')
    const r2 = await seedAt('Do meio', '2026-02-02T00:00:00Z')
    const r3 = await seedAt('Mais nova', '2026-02-03T00:00:00Z')

    // Página 1 (limit 2): as 2 mais novas, na ordem desc.
    const page1 = await feedBody({ limit: '2' })
    expect(ids(page1.feed)).toEqual([r3, r2])
    expect(page1.nextCursor).not.toBeNull()

    // Página 2 (segue o cursor): a mais antiga, e fim.
    const page2 = await feedBody({ limit: '2', cursor: page1.nextCursor! })
    expect(ids(page2.feed)).toEqual([r1])
    expect(page2.nextCursor).toBeNull()

    // Sem overlap entre páginas.
    expect(ids(page1.feed)).not.toContain(r1)
    expect(ids(page2.feed)).not.toContain(r3)
  })

  it('AC3: cursor malformado → começo do feed (permissivo, sem 400/500)', async () => {
    const r1 = await seedAt('Única', '2026-03-01T00:00:00Z')

    const res = await feedReq({ cursor: 'lixo!!!nao-base64' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as FeedResponse
    // Cursor inválido tratado como ausente ⇒ devolve o começo (a receita aparece).
    expect(ids(body.feed)).toContain(r1)
  })

  it('AC4: cursor base64 BEM-FORMADO mas com valor inválido → começo, NÃO 500 (DoS anônimo)', async () => {
    const r1 = await seedAt('Existe', '2026-04-01T00:00:00Z')

    // base64 de {"c":"not-a-timestamp","i":"not-a-uuid"}: passa o decode de FORMA, mas o valor
    // estouraria o cast `::timestamptz`/`::uuid` se chegasse ao SQL. decodeCursor valida o VALOR
    // ⇒ vira null ⇒ começo do feed (200), nunca 500. (O 'lixo!!!' do AC3 falha já no atob — caso
    // distinto; este exercita o ramo forma-válida-valor-inválido.)
    const crafted = btoa(JSON.stringify({ c: 'not-a-timestamp', i: 'not-a-uuid' }))
    const res = await feedReq({ cursor: crafted })
    expect(res.status).toBe(200)
    const body = (await res.json()) as FeedResponse
    expect(ids(body.feed)).toContain(r1)
  })
})

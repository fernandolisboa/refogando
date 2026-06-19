import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET as searchGET } from '@/app/api/search/route'
import { GET as feedGET } from '@/app/api/feed/route'
import { seedRecipe, seedTranslation, seedRemovedFromPool } from '../helpers/recipes'
import { seedUser, seedSessionHeaders } from '../helpers/users'

/**
 * #116 — Busca (/api/search) e Feed (/api/feed) incluem as PRÓPRIAS Receitas do viewer LOGADO
 * (privadas inclusive), além do pool da comunidade (owner NULL OR public). LEAK-SAFETY é o
 * requisito #1: o gate extra é EXATAMENTE `owner_id = <viewerId>` (BINDADO) — a privada de
 * OUTRO usuário NUNCA aparece. Anônimo (sem sessão) ⇒ só o pool da comunidade (de antes).
 *
 * Pela porta MAIS ALTA: os handlers GET resolvem a sessão do cookie via `requireSession`
 * (opcional — não 401). `seedSessionHeaders` minta uma sessão real pela mesma instância
 * getAuth() e devolve headers; sem headers = Visitante anônimo. Cobre os DOIS loaders
 * (search.ts e feed.ts) com os MESMOS dados semeados.
 *
 * Cada caso tem controle negativo NÃO-vácuo: a privada do outro EXISTE no banco (semeada +
 * casaria o termo) mas está ausente do resultado — prova o gate, não um banco vazio.
 */

type Hit = { recipeId: string; displayedTitle: string; origin: string; autoTranslationSignal: boolean }
type SearchResponse = { catalogo: Hit[]; comunidade: Hit[]; sugestoes?: Hit[] }
type FeedResponse = { feed: Hit[]; nextCursor: string | null }

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Busca pela porta alta. `headers` ausente = Visitante anônimo. */
function search(q: string, headers?: Headers): Promise<Response> {
  const params = new URLSearchParams({ q, locale: 'pt-BR' })
  return searchGET(new Request(`http://localhost/api/search?${params.toString()}`, { headers }))
}

async function searchBody(q: string, headers?: Headers): Promise<SearchResponse> {
  const res = await search(q, headers)
  expect(res.status).toBe(200)
  return (await res.json()) as SearchResponse
}

/** Todos os ids de uma SearchResponse (catálogo + comunidade + sugestões). */
function searchIds(b: SearchResponse): string[] {
  return [...b.catalogo, ...b.comunidade, ...(b.sugestoes ?? [])].map((h) => h.recipeId)
}

/** Feed pela porta alta (limit alto p/ uma página só). `headers` ausente = anônimo. */
function feed(headers?: Headers): Promise<Response> {
  const params = new URLSearchParams({ locale: 'pt-BR', limit: '50' })
  return feedGET(new Request(`http://localhost/api/feed?${params.toString()}`, { headers }))
}

async function feedIds(headers?: Headers): Promise<string[]> {
  const res = await feed(headers)
  expect(res.status).toBe(200)
  const b = (await res.json()) as FeedResponse
  return b.feed.map((h) => h.recipeId)
}

/**
 * Semeia o universo: viewer A e viewer B, cada um com uma PRIVADA + uma PÚBLICA própria, mais
 * uma receita de catálogo (owner NULL). TODAS casam o termo de busca 'cebola' (no título) e
 * têm título distinto p/ asserir por id. Devolve os ids + os headers de sessão de A e B.
 */
async function seedUniverse() {
  const aSess = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com` })
  const bSess = await seedSessionHeaders({ email: `b-${crypto.randomUUID()}@ex.com` })

  // Catálogo (owner NULL) — sempre visível para todos.
  const cat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: cat, locale: 'pt-BR', titulo: 'Sopa de cebola do catálogo', provenance: 'escrita_por_pessoa' })

  // A: pública (pool) + privada (só A).
  const aPub = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: aSess.userId, visibility: 'public' })
  await seedTranslation({ recipeId: aPub, locale: 'pt-BR', titulo: 'Cebola pública do A', provenance: 'escrita_por_pessoa' })
  const aPriv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: aSess.userId, visibility: 'private' })
  await seedTranslation({ recipeId: aPriv, locale: 'pt-BR', titulo: 'Cebola privada do A', provenance: 'escrita_por_pessoa' })

  // B: pública (pool) + privada (só B).
  const bPub = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: bSess.userId, visibility: 'public' })
  await seedTranslation({ recipeId: bPub, locale: 'pt-BR', titulo: 'Cebola pública do B', provenance: 'escrita_por_pessoa' })
  const bPriv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: bSess.userId, visibility: 'private' })
  await seedTranslation({ recipeId: bPriv, locale: 'pt-BR', titulo: 'Cebola privada do B', provenance: 'escrita_por_pessoa' })

  return { aSess, bSess, cat, aPub, aPriv, bPub, bPriv }
}

describe('#116 — Busca (/api/search) inclui as próprias do viewer, sem vazar as de outros', () => {
  it('A logado: vê catálogo + sua pública + sua privada; NUNCA a privada de B', async () => {
    const u = await seedUniverse()
    const got = searchIds(await searchBody('cebola', u.aSess.headers))

    // Inclui: comunidade (catálogo + ambas as públicas) + a PRÓPRIA privada de A.
    expect(got).toContain(u.cat)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPub)
    expect(got).toContain(u.aPriv)
    // Leak-safety (controle não-vácuo): a privada de B EXISTE e casa 'cebola', mas NÃO aparece.
    expect(got).not.toContain(u.bPriv)
  })

  it('B logado: vê catálogo + sua pública + sua privada; NUNCA a privada de A', async () => {
    const u = await seedUniverse()
    const got = searchIds(await searchBody('cebola', u.bSess.headers))

    expect(got).toContain(u.cat)
    expect(got).toContain(u.bPub)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPriv)
    expect(got).not.toContain(u.aPriv)
  })

  it('anônimo: só o pool da comunidade (catálogo + públicas); NENHUMA privada', async () => {
    const u = await seedUniverse()
    const got = searchIds(await searchBody('cebola'))

    expect(got).toContain(u.cat)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPub)
    // Ambas as privadas EXISTEM e casariam — ausentes (gate de comunidade puro).
    expect(got).not.toContain(u.aPriv)
    expect(got).not.toContain(u.bPriv)
  })
})

describe('#116 — Feed (/api/feed) inclui as próprias do viewer, sem vazar as de outros', () => {
  it('A logado: vê catálogo + ambas as públicas + sua privada; NUNCA a privada de B', async () => {
    const u = await seedUniverse()
    const got = await feedIds(u.aSess.headers)

    expect(got).toContain(u.cat)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPub)
    expect(got).toContain(u.aPriv)
    expect(got).not.toContain(u.bPriv)
  })

  it('B logado: vê catálogo + ambas as públicas + sua privada; NUNCA a privada de A', async () => {
    const u = await seedUniverse()
    const got = await feedIds(u.bSess.headers)

    expect(got).toContain(u.cat)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPub)
    expect(got).toContain(u.bPriv)
    expect(got).not.toContain(u.aPriv)
  })

  it('anônimo: só o pool da comunidade; NENHUMA privada', async () => {
    const u = await seedUniverse()
    const got = await feedIds()

    expect(got).toContain(u.cat)
    expect(got).toContain(u.aPub)
    expect(got).toContain(u.bPub)
    expect(got).not.toContain(u.aPriv)
    expect(got).not.toContain(u.bPriv)
  })
})

describe('#116 — moderação ortogonal: a PRÓPRIA removida-do-pool fica fora da Busca/Feed (espelha o pool)', () => {
  it('Busca/Feed do dono NÃO mostram a própria removida-do-pool (mas a privada normal sim)', async () => {
    const owner = await seedSessionHeaders({ email: `mod-owner-${crypto.randomUUID()}@ex.com` })
    const curatorId = await seedUser({ email: `mod-curator-${crypto.randomUUID()}@ex.com`, role: 'curador' })

    // Privada normal do dono — DEVE aparecer p/ o dono.
    const own = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner.userId, visibility: 'private' })
    await seedTranslation({ recipeId: own, locale: 'pt-BR', titulo: 'Bolo de cenoura privado', provenance: 'escrita_por_pessoa' })

    // Era pública do dono, depois REMOVIDA do pool por moderação — fora da Busca/Feed.
    const removed = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner.userId, visibility: 'public' })
    await seedTranslation({ recipeId: removed, locale: 'pt-BR', titulo: 'Bolo de cenoura removido', provenance: 'escrita_por_pessoa' })
    await seedRemovedFromPool({ recipeId: removed, curatorId })

    const sIds = searchIds(await searchBody('cenoura', owner.headers))
    expect(sIds).toContain(own)
    // Moderação NÃO foi alterada para linhas de comunidade; a removida do dono segue fora aqui
    // (leitura-do-dono da removida vive no detalhe, não na Busca/Feed — DO NOT change semantics).
    expect(sIds).not.toContain(removed)

    const fIds = await feedIds(owner.headers)
    expect(fIds).toContain(own)
    expect(fIds).not.toContain(removed)
  })
})

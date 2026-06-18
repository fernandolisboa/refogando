import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET } from '@/app/api/search/route'
import {
  seedRecipe,
  seedTranslation,
  seedRemovedFromPool,
  seedVote,
} from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Browse-all (#98) pela porta MAIS ALTA — handler GET de `/api/search?browse=1`. É a tela
 * /recipes: lista o pool (Catálogo + Comunidade) SEM texto nem faceta. Estende a Busca de
 * forma ADITIVA — mesmo seccionamento {catálogo,comunidade}, MESMO gate de leitura canônico
 * (owner NULL OR public; playful/removida excluídas). Visitante anônimo (ADR-0011, sem auth).
 * Cada AC tem ao menos um controle negativo NÃO-vacuamente-verde.
 */

type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: string
  autoTranslationSignal: boolean
}
type SearchResponse = {
  catalogo: SearchResult[]
  comunidade: SearchResult[]
}

type BrowseOpts = { cozinha?: string; sort?: string }

/** Browse pela porta alta — anônimo. `browse=1` sempre presente salvo override explícito. */
function browseReq(opts: BrowseOpts & { browse?: string } = {}): Promise<Response> {
  const params = new URLSearchParams({ locale: 'pt-BR' })
  if (opts.browse !== undefined) params.set('browse', opts.browse)
  else params.set('browse', '1')
  if (opts.cozinha) params.set('cozinha', opts.cozinha)
  if (opts.sort) params.set('sort', opts.sort)
  return GET(new Request(`http://localhost/api/search?${params.toString()}`))
}

async function browseBody(opts: BrowseOpts = {}): Promise<SearchResponse> {
  const res = await browseReq(opts)
  expect(res.status).toBe(200)
  return (await res.json()) as SearchResponse
}

const ids = (results: SearchResult[]): string[] => results.map((r) => r.recipeId)
const allIds = (body: SearchResponse): string[] => [...ids(body.catalogo), ...ids(body.comunidade)]

/** Receita de Comunidade pública (origin ai_chat, dono real, visibility public) + título. */
async function seedPublicCommunity(ownerId: string, titulo: string): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId,
    visibility: 'public',
    resultKind: 'success',
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

/** Receita de Catálogo (owner NULL → sempre legível) + título; cozinha opcional p/ faceta. */
async function seedCatalog(titulo: string, cozinha?: 'brasileira' | 'italiana'): Promise<string> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    resultKind: 'success',
    cozinha,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('GET /api/search?browse=1 — browse-all (#98)', () => {
  it('AC1: lista o pool seccionado E aplica o gate de leitura (privada/playful/removida ausentes)', async () => {
    const owner = await seedUser({ email: 'browse-owner@test.dev' })
    const curator = await seedUser({ email: 'browse-curator@test.dev', role: 'curador' })

    const cat = await seedCatalog('Feijoada do Catálogo')
    const pub = await seedPublicCommunity(owner, 'Strogonoff Público')

    // Privada (dono, visibility private) — NÃO deve aparecer.
    const priv = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: owner,
      visibility: 'private',
      resultKind: 'success',
    })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Privada Oculta', provenance: 'escrita_por_pessoa' })

    // Playful — NÃO deve aparecer (gate exclui result_kind playful). Catálogo (owner NULL)
    // para ISOLAR o gate de playful: passa o ramo de ownership (owner NULL ⇒ visível), então
    // a ausência prova o clause `result_kind <> 'playful'`, não a visibilidade. Playful exige
    // private (check recipe_playful_private_chk) — owner NULL + private é consistente.
    const playful = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      ownerId: null,
      visibility: 'private',
      resultKind: 'playful',
    })
    await seedTranslation({ recipeId: playful, locale: 'pt-BR', titulo: 'Zoeira do Catálogo', provenance: 'escrita_por_pessoa' })

    // Removida por moderação (era pública) — NÃO deve aparecer.
    const removed = await seedPublicCommunity(owner, 'Removida por Moderação')
    await seedRemovedFromPool({ recipeId: removed, curatorId: curator })

    const body = await browseBody()

    // Pool listado, seccionado por origem.
    expect(ids(body.catalogo)).toContain(cat)
    expect(ids(body.comunidade)).toContain(pub)

    // Gate (controle não-vácuo): seeds existem mas estão FORA de ambas as seções.
    const all = allIds(body)
    expect(all).not.toContain(priv)
    expect(all).not.toContain(playful)
    expect(all).not.toContain(removed)
  })

  it('AC2: faceta estreita o browse (cozinha), mantendo o seccionamento', async () => {
    const brasileira = await seedCatalog('Moqueca', 'brasileira')
    const italiana = await seedCatalog('Lasanha', 'italiana')

    const body = await browseBody({ cozinha: 'brasileira' })

    // Só a brasileira sobrevive ao filtro (controle: a italiana some).
    expect(ids(body.catalogo)).toContain(brasileira)
    expect(allIds(body)).not.toContain(italiana)
  })

  it('AC3: sem browse e sem q/faceta → vazio (comportamento neutro de hoje INTACTO)', async () => {
    // Mesmo seed visível, mas SEM browse=1: o early-return neutro segue valendo.
    const cat = await seedCatalog('Feijoada Neutra')

    const res = await GET(new Request('http://localhost/api/search?locale=pt-BR'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchResponse
    expect(body.catalogo).toEqual([])
    expect(body.comunidade).toEqual([])

    // Controle não-vácuo: o MESMO seed COM browse=1 apareceria.
    const browsed = await browseBody()
    expect(ids(browsed.catalogo)).toContain(cat)
  })

  it('AC4: browse + sort=popularidade ordena a Comunidade por votos (Catálogo intocado)', async () => {
    const owner = await seedUser({ email: 'browse-pop-owner@test.dev' })
    const voterA = await seedUser({ email: 'browse-voter-a@test.dev' })
    const voterB = await seedUser({ email: 'browse-voter-b@test.dev' })

    const menosVotada = await seedPublicCommunity(owner, 'Menos Votada')
    const maisVotada = await seedPublicCommunity(owner, 'Mais Votada')

    // maisVotada: 2 votos; menosVotada: 1 voto.
    await seedVote({ userId: voterA, recipeId: maisVotada })
    await seedVote({ userId: voterB, recipeId: maisVotada })
    await seedVote({ userId: voterA, recipeId: menosVotada })

    const body = await browseBody({ sort: 'popularidade' })
    const order = ids(body.comunidade)
    expect(order.indexOf(maisVotada)).toBeLessThan(order.indexOf(menosVotada))
  })
})

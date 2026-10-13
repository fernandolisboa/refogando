import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { GET } from '@/app/api/search/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import type { Restricao } from '@/domain/vocabulary'
import { __clearVocabularyCache } from '@/server/vocabulary/load'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Busca com as Restrições SALVAS no perfil (ADR-0041 dec.3) pela porta alta, `GET /api/search`. A lista NUNCA
 * anda em URL: o cliente manda só `?restricaoPerfil=1` e o servidor lê `users.restricoes` da sessão. Ela filtra,
 * é ecoada ao titular (`restricoesPerfil`), mas NÃO conta como faceta explícita — a lente de Perfil culinário
 * e o eco da `consulta` seguem funcionando. Visitante: o pedido é ignorado.
 */

type Body = {
  minhas: { recipeId: string }[]
  catalogo: { recipeId: string }[]
  comunidade: { recipeId: string }[]
  consulta?: { cozinhas?: string[]; restricoes?: string[] }
  restricoesPerfil?: string[]
}

function search(params: Record<string, string>, headers?: Headers): Promise<Response> {
  const qs = new URLSearchParams({ locale: 'pt-BR', ...params })
  return GET(new Request(`http://localhost/api/search?${qs.toString()}`, { headers }))
}

async function body(res: Response): Promise<Body> {
  expect(res.status).toBe(200)
  return (await res.json()) as Body
}

const allIds = (b: Body): string[] => [...b.minhas, ...b.catalogo, ...b.comunidade].map((r) => r.recipeId)

async function seedCurry(titulo: string, restricoes: Restricao[]): Promise<string> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'japonesa',
    categoria: 'prato_principal',
    restricoes,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

async function logadoCom(email: string, restricoes: Restricao[]): Promise<Headers> {
  const { userId, headers } = await seedSessionHeaders({ email })
  await getDb().update(users).set({ restricoes }).where(eq(users.id, userId))
  return headers
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

beforeEach(async () => {
  await seedVocabularyCozinhas(getDb())
  __clearVocabularyCache()
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('GET /api/search — Restrições salvas no perfil (ADR-0041 dec.3)', () => {
  it('logado + restricaoPerfil=1: filtra pelas salvas, ecoa ao titular e não é cacheável', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const frango = await seedCurry('Curry de frango', [])
    const headers = await logadoCom('busca-perfil@restricoes.test', ['vegano'])

    const res = await search({ q: 'curry', restricaoPerfil: '1' }, headers)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const b = await body(res)
    expect(allIds(b)).toContain(vegano)
    expect(allIds(b)).not.toContain(frango)
    expect(b.restricoesPerfil).toEqual(['vegano'])
  })

  it('sem o pedido, o mesmo logado vê tudo (e nada é ecoado)', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const frango = await seedCurry('Curry de frango', [])
    const headers = await logadoCom('sem-pedido@restricoes.test', ['vegano'])

    const b = await body(await search({ q: 'curry' }, headers))
    expect(allIds(b)).toEqual(expect.arrayContaining([vegano, frango]))
    expect(b).not.toHaveProperty('restricoesPerfil')
  })

  it('Visitante: o pedido é ignorado', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const frango = await seedCurry('Curry de frango', [])

    const b = await body(await search({ q: 'curry', restricaoPerfil: '1' }))
    expect(allIds(b)).toEqual(expect.arrayContaining([vegano, frango]))
    expect(b).not.toHaveProperty('restricoesPerfil')
  })

  it('logado sem nada salvo: o pedido não filtra', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const frango = await seedCurry('Curry de frango', [])
    const headers = await logadoCom('nada-salvo@restricoes.test', [])

    const b = await body(await search({ q: 'curry', restricaoPerfil: '1' }, headers))
    expect(allIds(b)).toEqual(expect.arrayContaining([vegano, frango]))
    expect(b).not.toHaveProperty('restricoesPerfil')
  })

  it('restrição escolhida à mão vence o pedido do perfil', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const semGluten = await seedCurry('Curry sem glúten', ['sem_gluten'])
    const headers = await logadoCom('escolha-manda@restricoes.test', ['vegano'])

    const b = await body(await search({ q: 'curry', restricao: 'sem_gluten', restricaoPerfil: '1' }, headers))
    expect(allIds(b)).toContain(semGluten)
    expect(allIds(b)).not.toContain(vegano)
    expect(b).not.toHaveProperty('restricoesPerfil')
  })

  it('a lente de Perfil culinário segue rodando (o perfil NÃO conta como faceta explícita)', async () => {
    const vegano = await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const frango = await seedCurry('Curry de frango', [])
    const headers = await logadoCom('lente@restricoes.test', ['vegano'])

    const b = await body(await search({ q: 'asiático', restricaoPerfil: '1' }, headers))
    // A lente resolveu a intenção difusa — eco da consulta presente, sem as restrições do perfil nele.
    expect(b.consulta?.cozinhas).toEqual(expect.arrayContaining(['japonesa']))
    expect(b.consulta?.restricoes).toBeUndefined()
    // ...e o filtro do perfil somou-se às facetas resolvidas.
    expect(allIds(b)).toContain(vegano)
    expect(allIds(b)).not.toContain(frango)
    expect(b.restricoesPerfil).toEqual(['vegano'])
  })

  it('o pedido sozinho (sem termo nem faceta) não tira a busca do repouso', async () => {
    await seedCurry('Curry vegano de grão-de-bico', ['vegano'])
    const headers = await logadoCom('repouso@restricoes.test', ['vegano'])

    const b = await body(await search({ restricaoPerfil: '1' }, headers))
    expect(b).toEqual({ minhas: [], catalogo: [], comunidade: [] })
  })
})

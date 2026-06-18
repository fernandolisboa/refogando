import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { searchRecipes } from '@/server/recipe/search'
import { EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { seedRecipe, seedTranslation, seedEmbedding, seedVote } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Ordenação por Popularidade na Busca da COMUNIDADE (issue #16, ADR-0003), exercitando o
 * loader `searchRecipes` direto (mesma forma de search-semantica.test.ts). A chave de
 * Popularidade entra DENTRO do tier de exatidão (NUNCA acima — ADR-0008) e SÓ na Comunidade
 * (Catálogo editorial intocado). Sob sort=relevancia/ausente o ORDER BY colapsa byte-a-byte
 * no de hoje (#14). `setup.ts` trunca antes de cada teste.
 *
 * Vetores 1536-dim PINADOS (eK = base canônica), bind via literal pgvector `'[...]'`.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const DIM = 1536
function vecCos(c: number): number[] {
  const v = new Array<number>(DIM).fill(0)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}
const QUERY_VEC = (() => {
  const v = new Array<number>(DIM).fill(0)
  v[0] = 1
  return v
})()

function indexOf(hits: { recipe_id: string }[], id: string): number {
  return hits.findIndex((h) => h.recipe_id === id)
}

/** Receita de COMUNIDADE pública (origin ai_chat, dono). Título + embedding opcional. */
async function seedCommunity(
  ownerId: string,
  titulo: string,
  cos: number | null,
): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (cos !== null) await seedEmbedding({ recipeId: id, locale: 'pt-BR', embedding: vecCos(cos), model: EMBEDDING_MODEL })
  return id
}

/** Receita de CATÁLOGO (owner NULL, visibility default). Título + embedding opcional. */
async function seedCatalog(titulo: string, cos: number | null, id?: string): Promise<string> {
  const recipeId = await seedRecipe({ id, origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (cos !== null) await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(cos), model: EMBEDDING_MODEL })
  return recipeId
}

/** Vota N vezes na Receita, cada voto por um Usuário DISTINTO (PK composta). */
async function castVotes(recipeId: string, n: number, tag: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    const uid = await seedUser({ email: `vote-${tag}-${i}-${crypto.randomUUID()}@ex.com` })
    await seedVote({ userId: uid, recipeId })
  }
}

describe('Busca da Comunidade — ordenação por Popularidade (#16)', () => {
  // AC3a (posição da chave): popularidade NÃO sobrepõe o tiering ADR-0008.
  it('AC3a precisa-zero-voto ranqueia ACIMA de só-semântica-muito-votada sob popularidade', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `ac3a-owner-${crypto.randomUUID()}@ex.com` })

    // (i) PRECISA bucket-1 (título casa "Chili"), cosseno fraco, ZERO votos.
    const precise = await seedCommunity(owner, 'Chili de carne', 0.2)
    // (ii) SÓ-SEMÂNTICA bucket-2 (título NÃO casa "Chili"), cosseno forte, MUITOS votos.
    const semantic = await seedCommunity(owner, 'Ensopado apimentado da casa', 0.9)
    await castVotes(semantic, 5, 'ac3a')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
      sort: 'popularidade',
    })
    const iPrecise = indexOf(hits, precise)
    const iSemantic = indexOf(hits, semantic)
    expect(iPrecise).toBeGreaterThanOrEqual(0) // bucket 1 presente
    expect(iSemantic).toBeGreaterThanOrEqual(0) // bucket 2 presente (mesma seção comunidade)
    // Popularidade NÃO sobe a bucket-2: a precisa-zero-voto continua ACIMA.
    expect(iPrecise).toBeLessThan(iSemantic)
  })

  // AC3a (dentro do tier): popularidade ordena entre pares do MESMO bucket.
  it('AC3a duas Comunidade no MESMO bucket: a mais votada vem primeiro sob popularidade', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `ac3a2-owner-${crypto.randomUUID()}@ex.com` })

    // Ambas casam "Chili" no título (bucket 1, sinal de precisa IDÊNTICO via title_match),
    // SEM embedding (cosine 0 nos dois) ⇒ só a chave de popularidade desempata.
    const less = await seedCommunity(owner, 'Chili suave', null)
    const more = await seedCommunity(owner, 'Chili picante', null)
    await castVotes(more, 3, 'ac3a2-more')
    await castVotes(less, 1, 'ac3a2-less')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null, // sem semântica: isola a chave de popularidade no bucket 1
      sort: 'popularidade',
    })
    const iMore = indexOf(hits, more)
    const iLess = indexOf(hits, less)
    expect(iMore).toBeGreaterThanOrEqual(0)
    expect(iLess).toBeGreaterThanOrEqual(0)
    expect(iMore).toBeLessThan(iLess) // mais votada primeiro DENTRO do tier
  })

  // AC3a (relevância default): sob sort ausente, popularidade NÃO atua — empate cai no
  // tiebreaker recipe_id (a chave de popularidade é inerte).
  it('AC3a sob relevância (sort ausente) a popularidade NÃO reordena o mesmo bucket', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `ac3a3-owner-${crypto.randomUUID()}@ex.com` })
    // PKs pinados: LO < HI lexicalmente ⇒ sob relevância (sem popularidade) o tiebreaker
    // recipe_id ASC coloca LO ACIMA de HI, MESMO com HI mais votada.
    const LO = '00000000-0000-4000-8000-0000000000a1'
    const HI = '00000000-0000-4000-8000-0000000000b2'
    const lo = await seedRecipe({ id: LO, origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: owner })
    await seedTranslation({ recipeId: lo, locale: 'pt-BR', titulo: 'Chili A', provenance: 'escrita_por_pessoa' })
    const hi = await seedRecipe({ id: HI, origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: owner })
    await seedTranslation({ recipeId: hi, locale: 'pt-BR', titulo: 'Chili B', provenance: 'escrita_por_pessoa' })
    await castVotes(hi, 9, 'ac3a3-hi') // HI muito votada, mas relevância ignora votos

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      // sort ausente ⇒ 'relevancia'
    })
    const iLo = indexOf(hits, lo)
    const iHi = indexOf(hits, hi)
    expect(iLo).toBeGreaterThanOrEqual(0)
    expect(iHi).toBeGreaterThanOrEqual(0)
    // Sob relevância, recipe_id ASC (LO < HI) ⇒ LO acima, apesar de HI ter 9 votos.
    expect(iLo).toBeLessThan(iHi)
  })

  // AC3b (guarda do Catálogo load-bearing): Popularidade NÃO se aplica ao Catálogo.
  it('AC3b Catálogo mantém a ordem de relevância sob popularidade (votos não reordenam)', async () => {
    const db = getDb()
    // Dois catálogos no MESMO bucket-1 (ambos casam "Chili"), SEM embedding (cosine 0).
    // PKs pinados: FIRST < SECOND ⇒ sob relevância (tiebreak recipe_id ASC) FIRST vem antes.
    // Damos a FIRST ZERO votos e a SECOND MUITOS votos: se a popularidade VAZASSE para o
    // Catálogo, SECOND subiria; a guarda de section='comunidade' impede isso.
    const FIRST = '00000000-0000-4000-8000-0000000000c1'
    const SECOND = '00000000-0000-4000-8000-0000000000d2'
    const first = await seedCatalog('Chili editorial um', null, FIRST)
    const second = await seedCatalog('Chili editorial dois', null, SECOND)
    await castVotes(second, 7, 'ac3b-second') // muitos votos no que viria DEPOIS por relevância

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    const iFirst = indexOf(hits, first)
    const iSecond = indexOf(hits, second)
    expect(iFirst).toBeGreaterThanOrEqual(0)
    expect(iSecond).toBeGreaterThanOrEqual(0)
    // Catálogo IGNORA popularidade ⇒ ordem de relevância (recipe_id ASC) preservada:
    // FIRST (0 votos) continua ANTES de SECOND (7 votos).
    expect(iFirst).toBeLessThan(iSecond)
  })

  // AC3b (COALESCE / NULLS-FIRST): Comunidade com 0 votos no conjunto popularidade não
  // sobe ao topo por NULLS-FIRST do DESC (COALESCE(...,0) força int 0, não NULL).
  it('AC3b Comunidade com 0 votos NÃO precede a mais votada (COALESCE evita NULLS-FIRST)', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `ac3b2-owner-${crypto.randomUUID()}@ex.com` })
    const zero = await seedCommunity(owner, 'Chili sem votos', null)
    const voted = await seedCommunity(owner, 'Chili votado', null)
    await castVotes(voted, 4, 'ac3b2')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    expect(indexOf(hits, voted)).toBeLessThan(indexOf(hits, zero)) // votada primeiro; 0 não vai ao topo
  })

  // Regressão (UNION ALL / byte-idêntico): a busca semântica roda sem erro de SQL sob
  // popularidade E sob relevância; relevância produz a MESMA ordem que o baseline (sort
  // ausente). Prova a aridade intacta do UNION ALL do bucket2 com a coluna vote_count nova.
  it('regressão: popularidade e relevância rodam sem erro SQL; relevância == baseline byte-a-byte', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `reg-owner-${crypto.randomUUID()}@ex.com` })
    // Mistura: precisa (bucket 1) + só-semântica (bucket 2) na Comunidade + um catálogo.
    const p = await seedCommunity(owner, 'Sopa de mandioca', 0.2)
    const s = await seedCommunity(owner, 'Caldo verde da vovó', 0.9) // só-semântica
    const cat = await seedCatalog('Sopa de cebola', 0.3)
    await castVotes(s, 2, 'reg-s')
    await castVotes(p, 1, 'reg-p')

    const args = {
      q: 'Sopa',
      terms: ['Sopa'],
      mode: 'any' as const,
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
    }
    // Roda sob popularidade (exercita o bucket2 UNION ALL com vote_count): sem erro de SQL.
    const pop = await searchRecipes(db, { ...args, sort: 'popularidade' })
    expect(pop.hits.length).toBeGreaterThan(0)
    // Todas as 4 fixtures aparecem (cap não as corta).
    expect(pop.hits.map((h) => h.recipe_id)).toEqual(expect.arrayContaining([p, s, cat]))

    // sort=relevancia explícito === sort ausente === baseline byte-a-byte (mesma ordem).
    const relExplicit = await searchRecipes(db, { ...args, sort: 'relevancia' })
    const baseline = await searchRecipes(db, args) // sem sort
    expect(relExplicit.hits.map((h) => h.recipe_id)).toEqual(baseline.hits.map((h) => h.recipe_id))
    expect(relExplicit.sugestoes.map((h) => h.recipe_id)).toEqual(baseline.sugestoes.map((h) => h.recipe_id))
  })
})

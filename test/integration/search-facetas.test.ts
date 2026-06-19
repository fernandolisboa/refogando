import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET } from '@/app/api/search/route'
import { seedFacetMatrix } from '../helpers/recipes'

/**
 * Facetas + Perfil culinário + filtros do Vocabulário (issue #10) pela porta MAIS ALTA —
 * handler GET de `/api/search`. Estende a Busca de #6/#9 de forma ADITIVA: facetas
 * (Cozinha/Categoria/Tag/Restrição/Dificuldade/Porções) estreitam o conjunto, e a lente
 * Perfil culinário resolve intenção difusa do `?q=` em facetas. Visitante anônimo (ADR-0011,
 * sem auth). Mesmo seccionamento {catálogo,comunidade}, mesmo gate de leitura canônico.
 *
 * Builder local de opts-objeto EXCLUSIVO deste arquivo — os builders posicionais de
 * search.test.ts (#6) e search-ingrediente.test.ts (#9) permanecem BYTE-IDÊNTICOS (trava
 * de reduce-to-#6/#9). Cada AC tem ao menos um controle negativo NÃO-vacuamente-verde.
 */

type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: string
  autoTranslationSignal: boolean
}
type FacetasResolvidasDTO = {
  cozinhas?: string[]
  categorias?: string[]
  tags?: string[]
  restricoes?: string[]
  dificuldade?: { min?: number; max?: number }
  porcoes?: { min?: number; max?: number }
}
type SearchResponse = {
  minhas: SearchResult[]
  catalogo: SearchResult[]
  comunidade: SearchResult[]
  consulta?: FacetasResolvidasDTO
}

type SearchOpts = {
  locale?: string
  match?: 'any' | 'all'
  cozinha?: string
  categoria?: string
  tag?: string
  restricao?: string
  dificuldade_min?: string
  dificuldade_max?: string
  porcoes_min?: string
  porcoes_max?: string
}

/** Busca pela porta alta — só adiciona à URL os params que vieram. Anônimo. */
function search(q: string, opts: SearchOpts = {}): Promise<Response> {
  const params = new URLSearchParams({ q })
  if (opts.locale) params.set('locale', opts.locale)
  if (opts.match) params.set('match', opts.match)
  if (opts.cozinha) params.set('cozinha', opts.cozinha)
  if (opts.categoria) params.set('categoria', opts.categoria)
  if (opts.tag) params.set('tag', opts.tag)
  if (opts.restricao) params.set('restricao', opts.restricao)
  if (opts.dificuldade_min) params.set('dificuldade_min', opts.dificuldade_min)
  if (opts.dificuldade_max) params.set('dificuldade_max', opts.dificuldade_max)
  if (opts.porcoes_min) params.set('porcoes_min', opts.porcoes_min)
  if (opts.porcoes_max) params.set('porcoes_max', opts.porcoes_max)
  return GET(new Request(`http://localhost/api/search?${params.toString()}`))
}

async function searchBody(q: string, opts: SearchOpts = {}): Promise<SearchResponse> {
  const res = await search(q, { locale: 'pt-BR', ...opts })
  expect(res.status).toBe(200)
  return (await res.json()) as SearchResponse
}

const ids = (results: SearchResult[]): string[] => results.map((r) => r.recipeId)
const allIds = (body: SearchResponse): string[] => [
  ...ids(body.minhas),
  ...ids(body.catalogo),
  ...ids(body.comunidade),
]

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('GET /api/search — Facetas + Perfil culinário (#10)', () => {
  it('AC1: texto + faceta estreita, mantém seccionamento (não-vacuamente-verde)', async () => {
    const m = await seedFacetMatrix()

    // (a) baseline NÃO-vazio: 'curry' sem faceta traz ≥1 catalogo E ≥1 comunidade.
    const baseline = await searchBody('curry')
    expect(baseline.catalogo.length).toBeGreaterThan(0)
    expect(baseline.comunidade.length).toBeGreaterThan(0)
    const baselineIds = allIds(baseline)
    expect(baselineIds).toEqual(expect.arrayContaining([m.F_jpDoce, m.F_itPrato, m.F_brDoce]))

    // (b) positiva sobre conjunto comprovadamente não-vazio: estreita por cozinha=japonesa.
    const narrowed = await searchBody('curry', { cozinha: 'japonesa' })
    expect(ids(narrowed.catalogo)).toContain(m.F_jpDoce)
    // remove F_itPrato (italiana) e F_brDoce (brasileira) de AMBAS as seções, mesmo casando 'curry'.
    expect(allIds(narrowed)).not.toContain(m.F_itPrato)
    expect(allIds(narrowed)).not.toContain(m.F_brDoce)

    // (c) o removido ESTAVA no baseline (prova que a faceta estreitou, não o texto).
    expect(baselineIds).toContain(m.F_itPrato)
    expect(baselineIds).toContain(m.F_brDoce)

    // Seccionamento preservado: F_jpDoce (catalog) no catálogo; F_itPrato (ai_chat) seria comunidade.
    expect(ids(narrowed.catalogo)).toContain(m.F_jpDoce)
  })

  it('AC2: Restrição (ARRAY+GIN) AND-contém-todas vs && overlap', async () => {
    const m = await seedFacetMatrix()

    // vegano,sem_gluten (faceta-only) inclui só receitas com AMBAS.
    const both = await searchBody('', { restricao: 'vegano,sem_gluten' })
    expect(allIds(both)).toContain(m.F_multiR)
    expect(allIds(both)).toContain(m.F_nullNums)
    // F_oneR (só vegano) e F_jpPrato (só vegano) NÃO aparecem (prova @> contém-TODAS, não &&).
    expect(allIds(both)).not.toContain(m.F_oneR)
    expect(allIds(both)).not.toContain(m.F_jpPrato)

    // vegano sozinho SIM inclui F_oneR (e F_jpPrato/F_multiR/F_nullNums).
    const veg = await searchBody('', { restricao: 'vegano' })
    expect(allIds(veg)).toContain(m.F_oneR)
    expect(allIds(veg)).toContain(m.F_jpPrato)
  })

  it('AC2: dificuldade faixa + NULL handling + exato', async () => {
    const m = await seedFacetMatrix()

    // dificuldade_max=2 inclui F_jpDoce(2)/F_thLeve(1)/F_multiR(2)/F_xxSaud(2); exclui F_itPrato(3)/F_jpPrato(4).
    const maxDif = await searchBody('', { dificuldade_max: '2' })
    expect(allIds(maxDif)).toEqual(
      expect.arrayContaining([m.F_jpDoce, m.F_thLeve, m.F_multiR, m.F_xxSaud]),
    )
    expect(allIds(maxDif)).not.toContain(m.F_itPrato)
    expect(allIds(maxDif)).not.toContain(m.F_jpPrato)
    // controle NULL: F_nullNums (dific NULL) cai fora (UNKNOWN).
    expect(allIds(maxDif)).not.toContain(m.F_nullNums)

    // exato: dificuldade_min=2 & dificuldade_max=2 inclui só dific=2.
    const exact = await searchBody('', { dificuldade_min: '2', dificuldade_max: '2' })
    expect(allIds(exact)).toContain(m.F_jpDoce)
    expect(allIds(exact)).toContain(m.F_multiR)
    expect(allIds(exact)).not.toContain(m.F_thLeve) // dific 1
    expect(allIds(exact)).not.toContain(m.F_itPrato) // dific 3
  })

  it('AC2: porções faixa [4,6] exclui 2/8 e o NULL', async () => {
    const m = await seedFacetMatrix()

    const body = await searchBody('', { porcoes_min: '4', porcoes_max: '6' })
    // F_jpDoce(4)/F_itPrato(6)/F_xxSaud(4)/F_multiR(4)/F_oneR(4)/F_tagDefeated(4)/F_decoy(4) na faixa.
    expect(allIds(body)).toContain(m.F_jpDoce)
    expect(allIds(body)).toContain(m.F_itPrato)
    // exclui 2 (F_jpPrato/F_thLeve), 8 (F_brDoce) e NULL (F_nullNums).
    expect(allIds(body)).not.toContain(m.F_jpPrato)
    expect(allIds(body)).not.toContain(m.F_thLeve)
    expect(allIds(body)).not.toContain(m.F_brDoce)
    expect(allIds(body)).not.toContain(m.F_nullNums)
  })

  it('AC2 Tag: fold SQL lado-tabela (surface form não-folded) + OR multivalor + isolamento', async () => {
    const m = await seedFacetMatrix()

    // OR multivalor: leve,saudavel traz F_jpDoce (só 'Leve') E F_xxSaud (só 'Saudável') via OR.
    const orTags = await searchBody('', { tag: 'leve,saudavel' })
    expect(allIds(orTags)).toContain(m.F_jpDoce) // pega bug tags[0]-só-1º deixaria de fora F_xxSaud
    expect(allIds(orTags)).toContain(m.F_xxSaud) // pega bug AND (exigiria as DUAS)
    expect(allIds(orTags)).toContain(m.F_thLeve) // ambas (não discrimina, mas presente)
    expect(allIds(orTags)).not.toContain(m.F_brDoce) // tag [classico], fora

    // Single + fold de ACENTO: ?tag=saudavel casa surface 'Saudável' (acentuada) via fold SQL.
    const saud = await searchBody('', { tag: 'saudavel' })
    expect(allIds(saud)).toContain(m.F_xxSaud)
    expect(allIds(saud)).toContain(m.F_thLeve)
    // Isolamento (espelha cebolaRoxaDefeated): F_tagDefeated ('saudavelx') NÃO aparece.
    expect(allIds(saud)).not.toContain(m.F_tagDefeated)

    // Fold de HÍFEN: ?tag=baixa-caloria casa surface 'baixa-caloria' via replace('-',' ').
    const hyphen = await searchBody('', { tag: 'baixa-caloria' })
    expect(allIds(hyphen)).toContain(m.F_thLeve)
  })

  it('AC2: faceta-only com q só-pontuação devolve resultado NÃO-vazio (seletor não usa terms.length===0)', async () => {
    const m = await seedFacetMatrix()

    // q=',,,' (parseSearchTerms=[]) + restricao=vegano ⇒ 200 NÃO-vazio (lê de `recipe`, não de `combined` vazio).
    const commas = await searchBody(',,,', { restricao: 'vegano' })
    expect(allIds(commas)).toEqual(expect.arrayContaining([m.F_multiR, m.F_nullNums, m.F_oneR]))

    // q='!!!' (parseSearchTerms=['!!!'], terms.length=1) + cozinha=japonesa ⇒ 200 NÃO-vazio.
    const bangs = await searchBody('!!!', { cozinha: 'japonesa' })
    expect(ids(bangs.catalogo)).toEqual(expect.arrayContaining([m.F_jpDoce, m.F_jpPrato]))
  })

  it('AC3: termo difuso resolve facetas via lente (não-vacuamente-verde; decoy ausente)', async () => {
    const m = await seedFacetMatrix()

    const body = await searchBody('asiático e leve')
    // consulta PRESENTE com cozinhas asiáticas + tags/dificuldade de "leve".
    expect(body.consulta).toBeDefined()
    expect(body.consulta?.cozinhas).toEqual(
      expect.arrayContaining(['japonesa', 'chinesa', 'tailandesa', 'indiana']),
    )
    expect(body.consulta?.tags).toContain('leve')
    expect(body.consulta?.dificuldade).toEqual({ max: 2 })

    // recall via faceta resolvida (títulos SEM "asiático"/"leve"): F_thLeve (tailandesa,
    // dific 1, tag 'leve') casa. F_jpDoce (japonesa, dific 2, tag 'Leve') casa.
    expect(allIds(body)).toContain(m.F_thLeve)
    expect(allIds(body)).toContain(m.F_jpDoce)

    // F_decoy: título contém "asiático leve" mas cozinha francesa + dific 5 ⇒ AUSENTE
    // (a lente consumiu os tokens; faceta-only, nenhum FTS roda ⇒ veio da faceta, não do texto).
    expect(allIds(body)).not.toContain(m.F_decoy)

    // Controle negativo POR-EIXO: F_decoy falha os TRÊS eixos (francesa cai já na cozinha),
    // então sozinho não distingue uma lente que dropasse tag/dificuldade. Estes dois PASSAM
    // a cozinha asiática resolvida (indiana/japonesa) mas DEVEM ser excluídos pela lente:
    //  - F_nullNums: dific NULL (cai fora de {max:2}) E sem tag 'leve';
    //  - F_jpPrato: dific 4 (> max 2) E sem tag 'leve'.
    // Juntas, estas duas asserções provam que ao-menos-um de {tag, dificuldade} está ATIVO
    // (se a lente silenciosamente dropasse os DOIS eixos, ambas vazariam por cozinha só).
    expect(allIds(body)).not.toContain(m.F_nullNums)
    expect(allIds(body)).not.toContain(m.F_jpPrato)

    // Prova de via diferente: o título de F_thLeve NÃO contém "asiát"/"leve".
    const thLeveHit = body.catalogo.find((r) => r.recipeId === m.F_thLeve)
    expect(thLeveHit).toBeDefined()
    const t = (thLeveHit as SearchResult).displayedTitle.toLowerCase()
    expect(t).not.toContain('asiát')
    expect(t).not.toContain('leve')
  })

  it('AC3: q-restante isolado quando token sobra (não over-afirma interseção)', async () => {
    await seedFacetMatrix()

    // "frango" sobra como q-restante; as fixtures-base não têm 'frango' ⇒ asserir SÓ que
    // (i) consulta presente (intenção resolvida) e (ii) status 200 (q-restante isolado).
    const res = await search('asiático e leve frango', { locale: 'pt-BR' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchResponse
    expect(body.consulta).toBeDefined()
    expect(body.consulta?.cozinhas).toEqual(
      expect.arrayContaining(['japonesa', 'chinesa', 'tailandesa', 'indiana']),
    )
  })

  it('AC4: facetas explícitas são honradas, lente NÃO re-impõe (ciclo de 2 estágios)', async () => {
    const m = await seedFacetMatrix()

    // Estágio 1 (lente resolve): consulta PRESENTE; conjunto A = {F_thLeve, F_jpDoce}.
    const stage1 = await searchBody('asiático e leve')
    expect(stage1.consulta).toBeDefined()
    expect(allIds(stage1)).toEqual(expect.arrayContaining([m.F_thLeve, m.F_jpDoce]))

    // Estágio 2 (cliente EDITA a Consulta — NÃO re-manda a intenção): só ?cozinha=italiana.
    const stage2 = await searchBody('', { cozinha: 'italiana' })
    // lente SUPRIMIDA ⇒ consulta AUSENTE no body.
    expect('consulta' in stage2).toBe(false)
    // F_itPrato (italiana, verbatim) ∈ resultado.
    expect(allIds(stage2)).toContain(m.F_itPrato)
    // conjunto A da lente NÃO aparece (intenção difusa não foi re-imposta).
    expect(allIds(stage2)).not.toContain(m.F_thLeve)
    expect(allIds(stage2)).not.toContain(m.F_jpDoce)
  })

  it('Gate faceta-only: F_playful/F_priv ausentes em search("",{cozinha:japonesa}); ramo OR-NULL preservado', async () => {
    const m = await seedFacetMatrix()

    // q vazio ⇒ FROM recipe r (ramo faceta-only). cozinha=japonesa casa F_playful/F_priv
    // (que CASARIAM a faceta) E os catálogos owner-NULL japoneses — trava as DUAS metades do gate.
    const body = await searchBody('', { cozinha: 'japonesa' })
    expect(allIds(body)).not.toContain(m.F_playful) // exclusão de playful
    expect(allIds(body)).not.toContain(m.F_priv) // private+owned barrado
    // ramo OR-NULL preservado: os catálogos private+owner-NULL aparecem.
    expect(ids(body.catalogo)).toEqual(expect.arrayContaining([m.F_jpDoce, m.F_jpPrato]))
  })

  it('AC5: faceta sem receita → seções vazias 200, sem beco', async () => {
    await seedFacetMatrix()

    // nenhuma receita peruana semeada ⇒ {minhas:[],catalogo:[],comunidade:[]} status 200.
    // #116/own-label: shape neutro agora carrega a chave `minhas:[]` (3 seções).
    const peruana = await search('', { locale: 'pt-BR', cozinha: 'peruana' })
    expect(peruana.status).toBe(200)
    expect(await peruana.json()).toEqual({ minhas: [], catalogo: [], comunidade: [] })

    // combinação impossível: japonesa + restrições que ninguém casa ⇒ vazio 200.
    const impossible = await searchBody('', {
      cozinha: 'japonesa',
      restricao: 'sem_oleaginosas,sem_frutos_do_mar',
    })
    expect(impossible.catalogo).toEqual([])
    expect(impossible.comunidade).toEqual([])
  })

  it('AC5 robustez: input inválido → 200 (NUNCA 500/22P02)', async () => {
    await seedFacetMatrix()

    // cozinha inválida descartada por parseFacetParams (isCozinha) ⇒ 200 (bindar cru ⇒ 22P02→500).
    const xpto = await search('', { locale: 'pt-BR', cozinha: 'xpto' })
    expect(xpto.status).toBe(200)

    // bound fora-de-faixa IGNORADO ⇒ 200.
    const big = await search('', { locale: 'pt-BR', dificuldade_max: '99' })
    expect(big.status).toBe(200)

    // eixo cozinha inteiro inválido ⇒ vazio ⇒ sem-filtro; texto 'curry' segue a FTS ⇒ 200.
    const textOk = await search('curry', { locale: 'pt-BR', cozinha: 'xpto,foo' })
    expect(textOk.status).toBe(200)
    const body = (await textOk.json()) as SearchResponse
    expect(allIds(body).length).toBeGreaterThan(0)
  })

  it('reduce-to-#9: search("frango,limão,alho", match=all) sem faceta ≡ #9 (vírgula preservada)', async () => {
    // Sem faceta ⇒ useLens=true, mas nada casa o mapa ⇒ resolved=false ⇒ remainingQuery=q0
    // VERBATIM (vírgulas preservadas byte-a-byte). Espelha search-ingrediente.test.ts:89-102:
    // a Receita com os três ingredientes (overlap=3=N) entra; a parcial (overlap 2≠3) sai.
    // Reusa o seed de INGREDIENTE de #9 via import dinâmico para não acoplar à matriz de facetas.
    const { seedIngredientSearchMatrix } = await import('../helpers/recipes')
    const m = await seedIngredientSearchMatrix()

    const all = await searchBody('frango,limão,alho', { match: 'all' })
    expect(allIds(all)).toContain(m.R_all)
    expect(allIds(all)).not.toContain(m.R_partial2)
  })

  it('invariante NUNCA cria: count(recipe) inalterado antes/depois das buscas com faceta', async () => {
    await seedFacetMatrix()

    const before = (await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM recipe`)[0].count
    await searchBody('', { restricao: 'vegano,sem_gluten' })
    await searchBody('asiático e leve')
    await searchBody('', { cozinha: 'japonesa' })
    const after = (await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM recipe`)[0].count
    expect(after).toBe(before)
  })
})

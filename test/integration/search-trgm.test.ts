import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET as searchGET } from '@/app/api/search/route'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * #118 — Lane de TRIGRAMA (pg_trgm) no TÍTULO: recall por substring (ILIKE-contém) e por
 * typo/fuzzy (similarity()), ALÉM do FTS. Pela porta MAIS ALTA (GET de /api/search), o
 * mesmo padrão de search-feed-own.test.ts: seedSessionHeaders minta sessão real; sem
 * headers = Visitante anônimo. Os títulos são distintos por id (PKs não-determinísticos =>
 * asserção por pertencimento).
 *
 * LEAK-SAFETY é requisito #1 (#116/#118): a lane re-aplica viewerReadableSqlFragment com o
 * viewerId BINDADO — a privada de OUTRO usuário NUNCA aparece (TC5), e o anônimo só vê o
 * pool da comunidade (TC6). Cada negativo é NÃO-vácuo: a privada do outro EXISTE no banco e
 * casaria o termo, mas está ausente do resultado.
 *
 * Notas de stemming (load-bearing nos casos): sob a config 'portuguese' o FTS deriva
 * 'ovos' -> lexema 'ovos' e 'ovo' -> 'ovo' (não unificam). Então buscar 'ovo' NÃO casa por
 * FTS um título 'Ovos Mexidos Cremosos' — só pela lane de trigrama (contém '%ovo%'). Um
 * título singular 'Ovo ...' casa por FTS (lexema 'ovo'). É essa divergência que TC1/TC4
 * exploram para isolar a lane de trigrama do FTS.
 */

type Hit = { recipeId: string; displayedTitle: string; origin: string; autoTranslationSignal: boolean }
type SearchResponse = { minhas: Hit[]; catalogo: Hit[]; comunidade: Hit[]; sugestoes?: Hit[] }

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Busca pela porta alta. `headers` ausente = Visitante anônimo. `match` opcional (o route
 * lê o modo do param `match`; ausente/qualquer-coisa != 'all' => 'any'). */
function search(q: string, opts?: { headers?: Headers; match?: 'any' | 'all' }): Promise<Response> {
  const params = new URLSearchParams({ q, locale: 'pt-BR' })
  if (opts?.match) params.set('match', opts.match)
  return searchGET(new Request(`http://localhost/api/search?${params.toString()}`, { headers: opts?.headers }))
}

async function searchBody(q: string, opts?: { headers?: Headers; match?: 'any' | 'all' }): Promise<SearchResponse> {
  const res = await search(q, opts)
  expect(res.status).toBe(200)
  return (await res.json()) as SearchResponse
}

/** Todos os ids (minhas + catálogo + comunidade + sugestões). */
function allIds(b: SearchResponse): string[] {
  return [...b.minhas, ...b.catalogo, ...b.comunidade, ...(b.sugestoes ?? [])].map((h) => h.recipeId)
}
/** Só os ids das SEÇÕES (sem sugestões) — para asserir ordenação dentro da seção. */
function sectionIds(b: SearchResponse): string[] {
  return [...b.minhas, ...b.catalogo, ...b.comunidade].map((h) => h.recipeId)
}

/** Semeia uma receita de catálogo (owner NULL, sempre visível) com um título. */
async function seedCatalog(titulo: string): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

describe('#118 — lane de trigrama: substring + typo no título', () => {
  // ISOLAMENTO DA LANE (robusto a stemming): os casos de contém usam um SUBSTRING DE MEIO
  // DE PALAVRA ('remos' dentro de 'Cremosos'). Um substring interno NUNCA é um lexema FTS
  // (o stemmer português jamais emite 'remos' a partir de 'cremosos'), então o recall só
  // pode vir da lane de trigrama — independe de o stemmer unificar plural/singular. Idem
  // 'exid' dentro de 'Mexidos'. Isso prova a lane sem depender de uma asserção de stemming.

  it('TC1: busca parcial "remos" acha "Ovos Mexidos Cremosos" (ramo ILIKE-contém)', async () => {
    // 'remos' está contido em 'Cremosos' (substring interno) mas NÃO é um lexema FTS dela;
    // só a lane de trigrama (contém '%remos%') traz a receita. Não-vácuo: sem a lane, some.
    const ovos = await seedCatalog('Ovos Mexidos Cremosos')
    const got = allIds(await searchBody('remos'))
    expect(got).toContain(ovos)
  })

  it('TC2: typo "cremosi" acha "Ovos Mexidos Cremosos" (ramo similarity, behavioural)', async () => {
    // 'cremosi' (typo de 'cremoso') NÃO está contido na frase (contém falha) E não é lexema
    // FTS dela; só a similaridade trigrama (similarity('...cremosos', 'cremosi') >= piso) a
    // traz. Asserção COMPORTAMENTAL (sem número fixo): se a lane sumir/cair sob o piso, o id some.
    const ovos = await seedCatalog('Ovos Mexidos Cremosos')
    const got = allIds(await searchBody('cremosi'))
    expect(got).toContain(ovos)
  })

  it('TC3: multi-termo em match=any exige TODOS os termos no título (per-term AND)', async () => {
    // Termos separam por VÍRGULA (parseSearchTerms). 'remos,exid' => terms=['remos','exid']
    // (default match='any'). Cada termo (>=3 chars) gera um predicado AND-combinado na lane,
    // ambos substrings INTERNOS (sem FTS no meio): 'Ovos Mexidos Cremosos' contém 'remos'
    // (Cremosos) E 'exid' (Mexidos) => entra. 'Ovos Mexidos Fritos' contém 'exid' mas NÃO
    // 'remos' (nem contém nem similaridade>=piso) => excluído. Prova o AND por-termo.
    const both = await seedCatalog('Ovos Mexidos Cremosos')
    const onlyExid = await seedCatalog('Ovos Mexidos Fritos')
    const got = allIds(await searchBody('remos,exid'))
    expect(got).toContain(both)
    expect(got).not.toContain(onlyExid)
  })

  it('TC4: FTS ranqueia ACIMA de trigrama dentro da seção', async () => {
    // Busca por 'cremoso' (palavra real). R_fts: 'Creme Cremoso da Casa' — casa por FTS
    // (lexema 'cremoso', title_match=true). R_trgm: 'Bolo Supercremoso' — 'cremoso' está só
    // como substring interno de 'Supercremoso' (contém '%cremoso%'), NÃO é lexema FTS dela
    // => só-trigrama (title_match=false). Ambos catálogo; a 1a chave do ORDER BY
    // (overlap+title_match>0) dá 1 ao FTS e 0 ao trigrama-puro => o FTS vem antes na seção.
    const fts = await seedCatalog('Creme Cremoso da Casa')
    const trgm = await seedCatalog('Bolo Supercremoso')
    const ids = sectionIds(await searchBody('cremoso'))
    expect(ids).toContain(fts)
    expect(ids).toContain(trgm)
    expect(ids.indexOf(fts)).toBeLessThan(ids.indexOf(trgm))
  })

  it('TC5: cross-user LEAK — a privada de B (casa "ovo") NÃO vaza para A', async () => {
    const a = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com` })
    const b = await seedSessionHeaders({ email: `b-${crypto.randomUUID()}@ex.com` })

    // Privada de B com título que SÓ casa por trigrama (contém '%ovo%'); existe e casaria.
    const bPriv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: b.userId, visibility: 'private' })
    await seedTranslation({ recipeId: bPriv, locale: 'pt-BR', titulo: 'Ovos do B privado', provenance: 'escrita_por_pessoa' })
    // Própria privada de A (controle positivo não-vácuo): A DEVE vê-la.
    const aPriv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: a.userId, visibility: 'private' })
    await seedTranslation({ recipeId: aPriv, locale: 'pt-BR', titulo: 'Ovos do A privado', provenance: 'escrita_por_pessoa' })

    const got = allIds(await searchBody('ovo', { headers: a.headers }))
    expect(got).toContain(aPriv) // A vê a sua própria privada via trigrama
    expect(got).not.toContain(bPriv) // leak-safety: a de B nunca aparece
  })

  it('TC6: anônimo — só o pool (catálogo/público); NENHUMA privada por trigrama', async () => {
    const b = await seedSessionHeaders({ email: `b-${crypto.randomUUID()}@ex.com` })
    const cat = await seedCatalog('Ovos Beneditinos do catálogo')
    const bPriv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: b.userId, visibility: 'private' })
    await seedTranslation({ recipeId: bPriv, locale: 'pt-BR', titulo: 'Ovos privados do B', provenance: 'escrita_por_pessoa' })

    const got = allIds(await searchBody('ovo')) // sem headers = anônimo
    expect(got).toContain(cat)
    expect(got).not.toContain(bPriv)
  })

  it('TC7: usabilidade do índice — ILIKE-contém alcança recipe_translation_titulo_trgm_gin', async () => {
    // Mesma técnica de search-semantica.test.ts: SET LOCAL enable_seqscan=off dentro de uma
    // transação força o planner a usar o índice se ele for ELEGÍVEL. Alvejamos SÓ o ramo
    // ILIKE-contém (o operador %/LIKE-family usa o GIN trigrama); similarity()>=piso é um
    // FILTER de seqscan aceito e NÃO é testado aqui.
    await seedCatalog('Ovos Mexidos Cremosos para o índice')
    const planJson = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      const plan = await tx<{ 'QUERY PLAN': unknown[] }[]>`
        EXPLAIN (FORMAT JSON)
        SELECT recipe_id FROM recipe_translation
        WHERE lower(immutable_unaccent(titulo)) ILIKE '%ovo%'
      `
      return JSON.stringify(plan)
    })
    expect(planJson).toContain('recipe_translation_titulo_trgm_gin')
  })
})

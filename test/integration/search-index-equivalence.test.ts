import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { sql } from 'drizzle-orm'
import { makeDb, makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import {
  RECIPE_TS_CONFIGS,
  TRGM_MIN_SIM,
  searchRecipes,
  titleFtsMatchedSql,
  trgmThresholdSql,
  trgmTitlePredicateSql,
} from '@/server/recipe/search'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Achado C da auditoria de performance (2026-10-13): o full-text do TÍTULO e a lane de trigrama
 * passaram a usar os GIN de `recipe_translation`, SEM mudar resultado. Esta suíte prova a
 * equivalência rodando o predicado ANTIGO (copiado aqui, literal) e o NOVO (o fragmento que a Busca
 * usa) sobre o mesmo conjunto semeado, comparando ids e ranks exatos, e prova que o índice ficou
 * alcançável (com `enable_seqscan = off`, o mesmo truque do TC7 de search-trgm.test.ts).
 */

let rawSql: Sql

beforeAll(() => {
  rawSql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await rawSql?.end({ timeout: 5 })
})

const db = () => getDb()

type Row = { recipe_id: string; rank: number }

/** O `matched` como era antes (tsquery por linha, `recipe_ts_config(rt.locale)`), verbatim. */
function legacyMatchedSql(q: string) {
  return sql`
    SELECT
      rt.recipe_id AS recipe_id,
      ts_rank(
        rt.search_vector,
        websearch_to_tsquery(
          recipe_ts_config(rt.locale),
          immutable_unaccent(${q})
        )
      ) AS rank
    FROM recipe_translation rt
    WHERE rt.search_vector @@ websearch_to_tsquery(
      recipe_ts_config(rt.locale),
      immutable_unaccent(${q})
    )`
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => a.recipe_id.localeCompare(b.recipe_id) || a.rank - b.rank)
}

async function matchedRows(fragment: ReturnType<typeof sql>): Promise<Row[]> {
  const rows = await db().execute<Row>(sql`SELECT recipe_id, rank FROM (${fragment}) m`)
  return sortRows([...rows])
}

/** Semeia o mesmo conjunto bilíngue para as duas comparações (pt, en e locales que caem no fallback). */
async function seedCorpus(): Promise<void> {
  const rows: Array<{ locale: string; originalLocale: string; titulo: string; descricao: string }> = [
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Frango assado com batatas', descricao: 'Frango dourado no forno' },
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Bolo de cenoura', descricao: 'Bolo fofinho com cobertura de chocolate' },
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Feijão tropeiro', descricao: 'Feijão com farinha, ovos e couve' },
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Ovos Mexidos Cremosos', descricao: 'Café da manhã rápido' },
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Pão de queijo mineiro', descricao: 'Polvilho e queijo canastra' },
    { locale: 'pt-BR', originalLocale: 'pt-BR', titulo: 'Moqueca baiana', descricao: 'Peixe, dendê e leite de coco' },
    { locale: 'en-US', originalLocale: 'pt-BR', titulo: 'Roast chicken with potatoes', descricao: 'Golden chicken in the oven' },
    { locale: 'en-US', originalLocale: 'pt-BR', titulo: 'Carrot cake', descricao: 'Fluffy cake with chocolate frosting' },
    { locale: 'en-US', originalLocale: 'en-US', titulo: 'Scrambled eggs', descricao: 'Creamy eggs, quick breakfast' },
    { locale: 'en-US', originalLocale: 'en-US', titulo: 'Cheese bread', descricao: 'Brazilian cheese bread, frango free' },
    // Fallback do recipe_ts_config: tudo que não começa com 'pt' cai em 'english'.
    { locale: 'es-ES', originalLocale: 'es-ES', titulo: 'Pollo asado', descricao: 'Pollo al horno con patatas y chicken' },
    { locale: 'en-GB', originalLocale: 'en-GB', titulo: 'Baked potatoes', descricao: 'Potatoes in the oven' },
    // 'pt' sem região também é 'portuguese' (LIKE 'pt%').
    { locale: 'pt', originalLocale: 'pt', titulo: 'Frango xadrez', descricao: 'Frango com pimentão' },
  ]
  for (const r of rows) {
    const id = await seedRecipe({ origin: 'catalog', originalLocale: r.originalLocale, ownerId: null })
    await seedTranslation({ recipeId: id, locale: r.locale, titulo: r.titulo, descricao: r.descricao, provenance: 'escrita_por_pessoa' })
  }
}

const FTS_QUERIES = [
  'frango',
  'Frango',
  'feijao',
  'feijão tropeiro',
  'chicken',
  'chickens',
  'eggs',
  'ovos',
  'bolo -chocolate',
  '"cheese bread"',
  'cake or bolo',
  'pollo',
  'potatoes',
  'batata',
  'frango, batatas',
  'queijo,polvilho',
  'xyz inexistente',
  '!!!',
  '',
]

describe('achado C — full-text do título com config constante por braço', () => {
  it('a função recipe_ts_config ainda tem só os dois valores que viram braços (tripwire)', async () => {
    const [row] = await db().execute<{ def: string }>(
      sql`SELECT pg_get_functiondef('recipe_ts_config(text)'::regprocedure) AS def`,
    )
    // Se alguém ensinar um idioma novo à função, este teste quebra: RECIPE_TS_CONFIGS precisa do braço.
    expect(row.def).toContain("CASE WHEN $1 LIKE 'pt%' THEN 'portuguese' ELSE 'english' END")
    expect([...RECIPE_TS_CONFIGS]).toEqual(['portuguese', 'english'])
  })

  it('mesmas linhas e mesmo ts_rank que o predicado antigo, em todas as consultas', async () => {
    await seedCorpus()
    let nonEmpty = 0
    for (const q of FTS_QUERIES) {
      const before = await matchedRows(legacyMatchedSql(q))
      const after = await matchedRows(titleFtsMatchedSql(q))
      expect(after, `q=${JSON.stringify(q)}`).toEqual(before)
      if (before.length > 0) nonEmpty++
    }
    // Não-vácuo: a maioria das consultas casa alguma coisa (pt, en e o fallback es/en-GB).
    expect(nonEmpty).toBeGreaterThanOrEqual(12)
  })

  it('o braço english cobre o fallback (es-ES casa "pollo" e "chicken")', async () => {
    await seedCorpus()
    const pollo = await matchedRows(titleFtsMatchedSql('pollo'))
    expect(pollo.length).toBe(1)
    const chicken = await matchedRows(titleFtsMatchedSql('chicken'))
    expect(chicken.length).toBe(2) // Roast chicken (en-US) e Pollo asado (es-ES, pela descrição)
  })

  it('o GIN recipe_translation_search_vector_gin fica alcançável (antes: só Seq Scan)', async () => {
    await seedCorpus()
    const plans = await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      const after = await tx.execute(sql`EXPLAIN (FORMAT JSON) ${titleFtsMatchedSql('frango')}`)
      const before = await tx.execute(sql`EXPLAIN (FORMAT JSON) ${legacyMatchedSql('frango')}`)
      return { after: JSON.stringify([...after]), before: JSON.stringify([...before]) }
    })
    expect(plans.after).toContain('recipe_translation_search_vector_gin')
    expect(plans.before).not.toContain('recipe_translation_search_vector_gin')
  })
})

/** O predicado antigo do ramo de trigrama (sem escape de curinga, `similarity() >= piso`), verbatim. */
function legacyTrgmPredicateSql(term: string) {
  return sql`(
    lower(immutable_unaccent(rt2.titulo)) ILIKE '%' || lower(immutable_unaccent(${sql.param(term)})) || '%'
    OR similarity(lower(immutable_unaccent(rt2.titulo)), lower(immutable_unaccent(${sql.param(term)}))) >= ${TRGM_MIN_SIM}
  )`
}

async function trgmIds(pred: ReturnType<typeof sql>): Promise<string[]> {
  return db().transaction(async (tx) => {
    await tx.execute(trgmThresholdSql())
    const rows = await tx.execute<{ recipe_id: string }>(
      sql`SELECT DISTINCT rt2.recipe_id AS recipe_id FROM recipe_translation rt2 WHERE ${pred}`,
    )
    return rows.map((r) => r.recipe_id).sort()
  })
}

describe('achado C — lane de trigrama com o operador % (piso fixado na transação)', () => {
  const TERMS = ['frango', 'frang', 'franguinho', 'cremosi', 'remos', 'ovo', 'ovoss', 'chiken', 'queijo', 'qeijo', 'moqeca', 'pao', 'pão', 'xyz', 'potatos', 'bolo']

  it('mesmos ids que similarity() >= TRGM_MIN_SIM (termos sem curinga)', async () => {
    await seedCorpus()
    let nonEmpty = 0
    for (const term of TERMS) {
      const before = await trgmIds(legacyTrgmPredicateSql(term))
      const after = await trgmIds(trgmTitlePredicateSql(term))
      expect(after, `term=${term}`).toEqual(before)
      if (before.length > 0) nonEmpty++
    }
    expect(nonEmpty).toBeGreaterThanOrEqual(8)
  })

  it('% é >= (não >): com o GUC exatamente na similaridade do par (0.3f), o par casa pelo %', async () => {
    // similarity('3416a75f', '341') = 3/10 em float4 (0.3f = 0.30000001192092896 em float8). Com o GUC
    // nesse valor exato, só um corte '>=' casa o par; o GUC logo acima é o controle de que o teste separa
    // '>' de '>='. Com o GUC em 0.3 (float8, abaixo de 0.3f) '>' e '>=' dariam o mesmo resultado.
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: '3416a75f', provenance: 'escrita_por_pessoa' })
    const [sim] = await db().execute<{ exact: boolean }>(
      sql`SELECT similarity('3416a75f', '341') = 0.3::float4 AS exact`,
    )
    expect(sim.exact).toBe(true)
    // Só o ramo fuzzy (o mesmo % do GIN, sobre a mesma expressão): o ILIKE casaria '341' por substring.
    const fuzzyIds = (thr: string) =>
      db().transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${thr}, true)`)
        const rows = await tx.execute<{ recipe_id: string }>(sql`
          SELECT rt2.recipe_id AS recipe_id FROM recipe_translation rt2
          WHERE lower(immutable_unaccent(rt2.titulo)) % lower(immutable_unaccent(${'341'}))
        `)
        return rows.map((r) => r.recipe_id)
      })
    expect(await fuzzyIds('0.30000001192092896')).toEqual([id])
    expect(await fuzzyIds('0.30000002')).toEqual([])
  })

  it('o corte não depende do GUC do ambiente: com o default do banco em 0.9, o typo ainda casa', async () => {
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Ovos Mexidos Cremosos', provenance: 'escrita_por_pessoa' })
    const [{ dbname }] = await rawSql<{ dbname: string }[]>`SELECT current_database() AS dbname`
    // Só no banco descartável: test/global-setup.ts dá esse padrão de nome nos dois caminhos (container e
    // TEST_DATABASE_URL).
    expect(dbname).toMatch(/^refogando_test_[a-z0-9]+$/)
    // O GUC só existe depois que o pg_trgm carrega na sessão; sem isso o ALTER grava um placeholder, que
    // um papel sem superusuário não pode gravar. show_limit() carrega a extensão na MESMA conexão (begin).
    const alterDb = (stmt: string) =>
      rawSql.begin(async (t) => {
        await t`SELECT show_limit()`
        await t.unsafe(`ALTER DATABASE "${dbname}" ${stmt}`)
      })
    await alterDb('SET pg_trgm.similarity_threshold = 0.9')
    // Conexão NOVA (o ALTER DATABASE só vale para sessões abertas depois dele).
    const freshSql = makeSql(inject('databaseUrl'), { max: 1 })
    try {
      const fresh = makeDb(freshSql)
      const [{ thr }] = await fresh.execute<{ thr: string }>(
        sql`SELECT current_setting('pg_trgm.similarity_threshold') AS thr`,
      )
      expect(thr).toBe('0.9') // o ambiente "errado" está de fato em vigor nesta sessão
      const res = await searchRecipes(fresh, {
        q: 'cremosi',
        terms: ['cremosi'],
        mode: 'any',
        requestLocale: 'pt-BR',
        facets: EMPTY_FACETS,
        queryVector: null,
      })
      expect(res.hits.map((h) => h.recipe_id)).toContain(id)
      // set_config(..., true) é local da transação: a sessão volta ao valor dela depois.
      const [{ thr: after }] = await fresh.execute<{ thr: string }>(
        sql`SELECT current_setting('pg_trgm.similarity_threshold') AS thr`,
      )
      expect(after).toBe('0.9')
    } finally {
      await freshSql.end({ timeout: 5 })
      await alterDb('RESET pg_trgm.similarity_threshold')
    }
  })

  it('curinga digitado: o predicado ANTIGO casava por curinga, o novo casa só o literal (bug corrigido)', async () => {
    const seed = async (titulo: string) => {
      const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
      await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
      return id
    }
    const xyz = await seed('Bolo xyzwq')
    const qq = await seed('Torta qqzzk')
    const pct = await seed('Bolo zz%kk')
    const abc = await seed('Pão abcx')
    const bs = await seed('Pão a\\bcx')
    const cases: Array<{ term: string; legacy: string[]; fixed: string[] }> = [
      { term: '_yzw', legacy: [xyz], fixed: [] },
      { term: '＿yzw', legacy: [xyz], fixed: [] },
      { term: 'qq%', legacy: [qq], fixed: [] },
      // 'z%k' antigo = z, qualquer coisa, k: casava também 'Torta qqzzk'.
      { term: 'z%k', legacy: [pct, qq].sort(), fixed: [pct] },
      { term: 'z％k', legacy: [pct, qq].sort(), fixed: [pct] },
      // 'a\\bc': o '\\' antigo escapava o 'b' (padrão = 'abc'); agora é uma barra literal. A linha com a
      // barra também passa pelo ramo fuzzy (similaridade ~0.36), nos dois.
      { term: 'a\\bc', legacy: [abc, bs].sort(), fixed: [bs] },
    ]
    for (const c of cases) {
      expect(await trgmIds(legacyTrgmPredicateSql(c.term)), `antigo term=${c.term}`).toEqual(c.legacy)
      expect(await trgmIds(trgmTitlePredicateSql(c.term)), `novo term=${c.term}`).toEqual(c.fixed)
    }
  })

  it('o GIN recipe_translation_titulo_trgm_gin fica alcançável pelos dois ramos (BitmapOr)', async () => {
    await seedCorpus()
    const plans = await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      await tx.execute(trgmThresholdSql())
      const q = (pred: ReturnType<typeof sql>) =>
        tx.execute(sql`EXPLAIN (FORMAT JSON) SELECT rt2.recipe_id FROM recipe_translation rt2 WHERE ${pred}`)
      return {
        after: JSON.stringify([...(await q(trgmTitlePredicateSql('frango')))]),
        before: JSON.stringify([...(await q(legacyTrgmPredicateSql('frango')))]),
      }
    })
    expect(plans.after).toContain('recipe_translation_titulo_trgm_gin')
    expect(plans.after).toContain('BitmapOr')
    // Antes, o OR com similarity() derrubava os dois ramos para Seq Scan.
    expect(plans.before).not.toContain('recipe_translation_titulo_trgm_gin')
  })
})

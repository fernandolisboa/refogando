import { describe, it, expect } from 'vitest'
import { eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
import { ingredientTranslation, recipeIngredient } from '@/db/schema'
import { getDb } from '@/server/deps'
import { RECIPE_TS_CONFIGS, ingredientRawHitSql, searchRecipes } from '@/server/recipe/search'
import { viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import { applyAddPantryItems, loadPantryMatches, norm } from '@/server/pantry/pantry'
import { EMPTY_FACETS } from '@/domain/facet-params'
import {
  seedIngredient,
  seedIngredientTranslation,
  seedRecipe,
  seedRecipeIngredient,
  seedRemovedFromPool,
  seedTranslation,
} from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Achados C (ingrediente) e E da auditoria de performance (2026-10-13), migração 0076: a Busca e a
 * Despensa passaram a ler colunas GERADAS de `recipe_ingredient` (`raw_text_tsv_<config>`,
 * `raw_text_norm`) e de `ingredient_translation` (`nome_norm`) em vez de recalcular a expressão em toda
 * linha a cada consulta. Esta suíte prova que NADA muda no resultado:
 *  1. cada coluna guarda exatamente a expressão que a consulta antiga calculava, linha a linha, num corpus
 *     adversarial (acento, caixa, largura total, pontuação, espaços Unicode, NULL e vazio), e acompanha
 *     toda escrita (INSERT e UPDATE; coluna gerada não depende de caminho de escrita);
 *  2. o ramo `raw_text` da Busca antigo (copiado aqui, literal) e o novo (`ingredientRawHitSql`) devolvem
 *     os mesmos pares (Receita, termo), em vários locales, com e sem viewer;
 *  3. o casamento da Despensa antigo (a MESMA query com cada coluna trocada pela expressão que ela guarda,
 *     que é a query de antes) e o novo devolvem a mesma resposta;
 *  4. os GIN novos ficam alcançáveis (com `enable_seqscan = off`, como em search-index-equivalence).
 */

const db = () => getDb()
const dialect = new PgDialect()

/** A normalização da Despensa como era escrita na consulta antiga (pantry.ts `norm`), literal. */
const legacyNormText = (col: string) =>
  `btrim(regexp_replace(lower(immutable_unaccent(${col})), '[[:space:][:punct:]]+', ' ', 'g'))`

/** Textos de Item adversariais (NULL e vazio inclusos). */
const RAW_TEXTS: Array<string | null> = [
  'Frango desfiado',
  'FRANGO',
  'frangos',
  'Frango-caipira',
  'chicken',
  'Chickens!',
  'chicken breast, boneless',
  'Cebola-roxa',
  'cebola  roxa',
  'Ovos; claras',
  'ＯＶＯＳ',
  'ｆｒａｎｇｏ ｃａｉｐｉｒａ',
  'pão-de-ló',
  'Pães',
  'limões',
  'Açúcar (refinado)',
  'sal, pimenta e azeite',
  'Sal a gosto',
  'sal & pimenta q.b.',
  'água',
  'Água de coco',
  'tomate-cereja',
  'Tomates Cereja',
  'farinha de trigo integral',
  'Óleo',
  'oleo de soja',
  'crème brûlée',
  'jalapeño',
  'café',
  "chef's choice",
  'ovo\tcozido',
  'ovo\ncozido',
  'ovo cozido',
  '100% cacau',
  'a_b',
  'abc\\d',
  '🍗 frango',
  'Œufs',
  'ﬁlé de peixe',
  'straße',
  '—',
  '...',
  '',
  '   ',
  null,
]

const LOCALES = ['pt-BR', 'en-US', 'es-ES', 'pt', 'en-GB'] as const

type Corpus = { ownerId: string; otherId: string }

/**
 * Uma Receita de catálogo por locale com TODOS os textos; uma privada e uma pública de dono; uma
 * `playful` e uma removida do pool (gates); canônicos com nome/aliases adversariais; e uma tradução
 * en-US com nomes de Item (ADR-0030) para a Despensa.
 */
async function seedCorpus(): Promise<Corpus> {
  const ownerId = await seedUser({ email: `dono-${crypto.randomUUID()}@ex.com` })
  const otherId = await seedUser({ email: `outro-${crypto.randomUUID()}@ex.com` })
  const curatorId = await seedUser({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
  const withItems = async (recipeId: string, locale: string, texts: Array<string | null>) => {
    await seedTranslation({ recipeId, locale, titulo: `Receita ${locale}`, provenance: 'escrita_por_pessoa' })
    for (const [i, rawText] of texts.entries()) await seedRecipeIngredient({ recipeId, ordem: i, rawText })
    return recipeId
  }
  for (const locale of LOCALES) {
    await withItems(await seedRecipe({ origin: 'catalog', originalLocale: locale, ownerId: null }), locale, RAW_TEXTS)
  }
  // Receitas curtas (4 Itens, no máximo 3 faltando entra na Despensa) com os mesmos textos, em pt-BR e en-US.
  for (const locale of ['pt-BR', 'en-US']) {
    for (let i = 0; i < RAW_TEXTS.length; i += 4) {
      await withItems(await seedRecipe({ origin: 'catalog', originalLocale: locale, ownerId: null }), locale, RAW_TEXTS.slice(i, i + 4))
    }
  }
  const half = RAW_TEXTS.filter((_, i) => i % 2 === 0)
  const privatePt = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId, visibility: 'private' })
  await withItems(privatePt, 'pt-BR', half)
  const publicEn = await seedRecipe({ origin: 'ai_structured', originalLocale: 'en-US', ownerId: otherId, visibility: 'public' })
  await withItems(publicEn, 'en-US', half)
  const privateOther = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: otherId, visibility: 'private' })
  await withItems(privateOther, 'pt-BR', half)
  const playful = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId, visibility: 'private', resultKind: 'playful' })
  await withItems(playful, 'pt-BR', half)
  const removed = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await withItems(removed, 'pt-BR', half)
  await seedRemovedFromPool({ recipeId: removed, curatorId })

  // Tradução en-US das Receitas pt-BR do catálogo com nomes de Item (ADR-0030; alguns defasados, alguns vazios).
  const ptCatalog = await db().execute<{ id: string }>(
    sql`SELECT id FROM recipe WHERE owner_id IS NULL AND original_locale = 'pt-BR' AND moderation_removed_at IS NULL`,
  )
  for (const { id } of ptCatalog) {
    const items = await db()
      .select({ ordem: recipeIngredient.ordem, rawText: recipeIngredient.rawText })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, id))
    const ingredientes = items.flatMap(({ ordem, rawText }) =>
      rawText === null
        ? []
        : [{ ordem, nome: ordem % 5 === 0 ? '' : `Translated ${rawText}`, nomeOrigem: ordem % 7 === 0 ? 'outro texto' : rawText }],
    )
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: 'Recipe en', provenance: 'automatica_nao_revisada', ingredientes })
  }

  const canon: Array<{ locale: string; nome: string; aliases: string[] | null }[]> = [
    [
      { locale: 'pt-BR', nome: 'Ovo', aliases: ['ovos', 'Ovo caipira', 'ＯＶＯ'] },
      { locale: 'en-US', nome: 'Egg', aliases: null },
    ],
    [
      { locale: 'pt-BR', nome: 'Pimenta-do-reino', aliases: [] },
      { locale: 'en-US', nome: 'Black pepper', aliases: ['pepper, black'] },
    ],
    [{ locale: 'pt-BR', nome: 'Cebola  Roxa', aliases: ['cebola-roxa'] }],
    [{ locale: 'pt-BR', nome: 'ＦＡＲＩＮＨＡ', aliases: ['Farinha de Trigo'] }],
    [{ locale: 'pt-BR', nome: '...', aliases: ['—'] }],
    [{ locale: 'en-US', nome: 'Crème Brûlée', aliases: ["chef's choice"] }],
  ]
  for (const rows of canon) {
    const ingredientId = await seedIngredient({})
    for (const r of rows) await seedIngredientTranslation({ ingredientId, ...r })
  }
  return { ownerId, otherId }
}

describe('colunas geradas da 0076 guardam a expressão da consulta antiga', () => {
  it('raw_text_norm e nome_norm = norm(...) da Despensa, linha a linha (e norm segue a de antes)', async () => {
    // Tripwire: a função do código é a mesma expressão que a consulta antiga escrevia. Mudou a
    // normalização? As colunas geradas precisam mudar junto (migração com reescrita da tabela).
    expect(dialect.sqlToQuery(norm(sql`x`)).sql).toBe(legacyNormText('x'))
    await seedCorpus()
    const [ri] = await db().execute<{ total: number; same: number; nonEmpty: number }>(sql`
      SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE raw_text_norm IS NOT DISTINCT FROM ${sql.raw(legacyNormText('raw_text'))}))::int AS same,
        (count(*) FILTER (WHERE raw_text_norm <> ''))::int AS "nonEmpty"
      FROM recipe_ingredient`)
    expect(ri.total).toBeGreaterThan(200)
    expect(ri.same).toBe(ri.total)
    expect(ri.nonEmpty).toBeGreaterThan(100)
    const [it] = await db().execute<{ total: number; same: number }>(sql`
      SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE nome_norm IS NOT DISTINCT FROM ${sql.raw(legacyNormText('nome'))}))::int AS same
      FROM ingredient_translation`)
    expect(it.total).toBeGreaterThan(5)
    expect(it.same).toBe(it.total)
    // Não-vácuo: a normalização de fato transforma (largura total, acento, pontuação, espaço Unicode).
    const samples = await db().execute<{ raw_text: string; raw_text_norm: string }>(sql`
      SELECT raw_text, raw_text_norm FROM recipe_ingredient
      WHERE raw_text IN ('ＯＶＯＳ', 'Açúcar (refinado)', 'ovo' || chr(160) || 'cozido', '...') GROUP BY 1, 2 ORDER BY 1`)
    expect(Object.fromEntries(samples.map((s) => [s.raw_text, s.raw_text_norm]))).toEqual({
      '...': '',
      'Açúcar (refinado)': 'acucar refinado',
      'ovo cozido': 'ovo cozido',
      'ＯＶＯＳ': 'ovos',
    })
  })

  it('raw_text_tsv_<config> = to_tsvector(config, immutable_unaccent(raw_text)), para as duas configs', async () => {
    await seedCorpus()
    for (const cfg of RECIPE_TS_CONFIGS) {
      const col = sql.raw(`raw_text_tsv_${cfg}`)
      const cfgSql = sql.raw(`'${cfg}'::regconfig`)
      const [row] = await db().execute<{ total: number; same: number; viaLocale: number }>(sql`
        SELECT count(*)::int AS total,
          (count(*) FILTER (WHERE ${col} IS NOT DISTINCT FROM to_tsvector(${cfgSql}, immutable_unaccent(ri.raw_text))))::int AS same,
          -- A forma exata da consulta antiga: a config pela Receita (só as linhas cuja Receita cai nesta config).
          (count(*) FILTER (WHERE recipe_ts_config(r.original_locale) = ${cfgSql}
             AND ${col} IS NOT DISTINCT FROM to_tsvector(recipe_ts_config(r.original_locale), immutable_unaccent(ri.raw_text))))::int AS "viaLocale"
        FROM recipe_ingredient ri JOIN recipe r ON r.id = ri.recipe_id`)
      expect(row.same, cfg).toBe(row.total)
      const [{ n }] = await db().execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM recipe_ingredient ri JOIN recipe r ON r.id = ri.recipe_id
        WHERE recipe_ts_config(r.original_locale) = ${cfgSql}`)
      expect(row.viaLocale, cfg).toBe(n)
      expect(n, cfg).toBeGreaterThan(50)
    }
  })

  it('acompanham toda escrita: INSERT e UPDATE recalculam (nenhum caminho de escrita precisa lembrar)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const itemId = await seedRecipeIngredient({ recipeId, rawText: 'Ovos Caipiras' })
    const read = async () => {
      const [r] = await db()
        .select({ norm: recipeIngredient.rawTextNorm, pt: recipeIngredient.rawTextTsvPortuguese, en: recipeIngredient.rawTextTsvEnglish })
        .from(recipeIngredient)
        .where(eq(recipeIngredient.id, itemId))
      return r
    }
    expect(await read()).toEqual({ norm: 'ovos caipiras', pt: "'caip':2 'ovos':1", en: "'caipira':2 'ovo':1" })
    await db().update(recipeIngredient).set({ rawText: 'Pimenta-do-Reino' }).where(eq(recipeIngredient.id, itemId))
    expect((await read()).norm).toBe('pimenta do reino')
    await db().update(recipeIngredient).set({ rawText: null }).where(eq(recipeIngredient.id, itemId))
    expect(await read()).toEqual({ norm: null, pt: null, en: null })

    const ingredientId = await seedIngredient({})
    const trId = await seedIngredientTranslation({ ingredientId, locale: 'pt-BR', nome: 'Pão-de-Ló' })
    const nomeNorm = async () =>
      (await db().select({ n: ingredientTranslation.nomeNorm }).from(ingredientTranslation).where(eq(ingredientTranslation.id, trId)))[0].n
    expect(await nomeNorm()).toBe('pao de lo')
    await db().update(ingredientTranslation).set({ nome: 'Açúcar' }).where(eq(ingredientTranslation.id, trId))
    expect(await nomeNorm()).toBe('acucar')
  })
})

/** O `ingredient_raw_hit` como era antes (to_tsvector por linha, config pela Receita), verbatim. */
function legacyIngredientRawHitSql(viewerId: string | undefined): SQL {
  return sql`
      SELECT DISTINCT ri.recipe_id AS recipe_id, t.idx AS term_idx
      FROM recipe_ingredient ri
      JOIN recipe r2 ON r2.id = ri.recipe_id
      CROSS JOIN terms t
      WHERE ri.raw_text IS NOT NULL
        AND r2.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r2', viewerId)}
        AND r2.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        AND to_tsvector(
              recipe_ts_config(r2.original_locale),
              immutable_unaccent(ri.raw_text)
            ) @@ websearch_to_tsquery(
              recipe_ts_config(r2.original_locale),
              immutable_unaccent(t.term)
            )`
}

function withTerms(terms: string[], fragment: SQL): SQL {
  return sql`
    WITH terms AS (
      SELECT t.term AS term, t.idx AS idx
      FROM unnest(${sql.param(terms)}::text[]) WITH ORDINALITY AS t(term, idx)
    )
    SELECT recipe_id, term_idx::int AS term_idx FROM (${fragment}) x ORDER BY recipe_id, term_idx`
}

async function rawHits(terms: string[], fragment: SQL): Promise<string[]> {
  const rows = await db().execute<{ recipe_id: string; term_idx: number }>(withTerms(terms, fragment))
  return rows.map((r) => `${r.recipe_id}#${r.term_idx}`)
}

const TERM_SETS: string[][] = [
  ['frango'],
  ['Frango'],
  ['FRANGO'],
  ['frangos'],
  ['ｆｒａｎｇｏ'],
  ['chicken'],
  ['chickens'],
  ['ovos'],
  ['ovo'],
  ['eggs'],
  ['cebola roxa'],
  ['cebola-roxa'],
  ['tomate cereja'],
  ['pão'],
  ['paes'],
  ['limões'],
  ['acucar'],
  ['"sal pimenta"'],
  ['sal -azeite'],
  ['-farinha'],
  ['farinha or arroz'],
  ['agua de coco'],
  ['creme brulee'],
  ['jalapeno'],
  ['cafe'],
  ["chef's"],
  ['cozido'],
  ['100%'],
  ['a_b'],
  ['abc\\d'],
  ['filé'],
  ['strasse'],
  ['oeufs'],
  ['!!!'],
  ['—'],
  [''],
  ['   '],
  ['xyz inexistente'],
  ['frango', 'cebola roxa', 'ovos'],
  ['frango', 'frango'],
  ['chicken', 'farinha', 'água', 'Óleo', 'café', 'tomates cereja', 'sal', 'pimenta', 'limão', 'jalapeño', 'pão', 'ovo', 'cebola', 'abc', 'x', 'y'],
]

describe('achado C — ramo raw_text da Busca nas colunas tsvector geradas', () => {
  it('mesmos pares (Receita, termo) que o to_tsvector por linha, com e sem viewer', async () => {
    const { ownerId, otherId } = await seedCorpus()
    let nonEmpty = 0
    for (const terms of TERM_SETS) {
      for (const viewerId of [undefined, ownerId, otherId]) {
        const before = await rawHits(terms, legacyIngredientRawHitSql(viewerId))
        const after = await rawHits(terms, ingredientRawHitSql(viewerId))
        expect(after, `terms=${JSON.stringify(terms)} viewer=${viewerId ?? 'anon'}`).toEqual(before)
        if (before.length > 0) nonEmpty++
      }
    }
    // Não-vácuo: a maior parte dos conjuntos casa alguma coisa (pt, en e os locales do fallback).
    expect(nonEmpty).toBeGreaterThanOrEqual(75)
  })

  it('a config é a da Receita: "breasts" só casa em english (stem), "frangas" só em portuguese', async () => {
    await seedCorpus()
    const localeOf = async (terms: string[]) => {
      const rows = await db().execute<{ original_locale: string }>(sql`
        SELECT DISTINCT r.original_locale FROM (${withTerms(terms, ingredientRawHitSql(undefined))}) h
        JOIN recipe r ON r.id = h.recipe_id ORDER BY 1`)
      return rows.map((r) => r.original_locale)
    }
    // 'breasts' → english 'breast' (casa "chicken breast" em en-US, es-ES e en-GB); em portuguese fica 'breasts'.
    expect(await localeOf(['breasts'])).toEqual(['en-GB', 'en-US', 'es-ES'])
    // 'frangas' → portuguese 'frang' (casa "frango" em pt-BR e pt); em english fica 'franga', que não casa 'frango'.
    expect(await localeOf(['frangas'])).toEqual(['pt', 'pt-BR'])
  })

  it('a Busca inteira acha a Receita só pelo texto do Item (inclusive a privada do próprio viewer)', async () => {
    const { ownerId } = await seedCorpus()
    const [own] = await db().execute<{ id: string }>(
      sql`SELECT id FROM recipe WHERE owner_id = ${ownerId} AND visibility = 'private'`,
    )
    const res = await searchRecipes(db(), {
      q: 'brulee',
      terms: ['brulee'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      viewerId: ownerId,
    })
    const ids = res.hits.map((h) => h.recipe_id)
    expect(ids).toContain(own.id)
    // 5 longas + 2 curtas do catálogo, a privada do viewer e a pública de outro; sem a privada de outro, a
    // playful e a removida do pool.
    expect(ids.length).toBe(9)
  })

  it('os GIN recipe_ingredient_raw_text_tsv_*_gin atendem o @@ de cada braço, com o termo vindo de terms', async () => {
    await seedCorpus()
    // Num banco de teste o planner prefere ir pela Receita (poucas linhas); com volume (relatório da auditoria,
    // §6) o fragmento inteiro faz um Bitmap Index Scan parametrizado por termo. Aqui: o predicado de cada braço,
    // na mesma forma (tsquery da config constante sobre t.term), é atendido pelo GIN da config.
    const plans = await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      const out: Record<string, string> = {}
      for (const cfg of RECIPE_TS_CONFIGS) {
        const rows = await tx.execute(sql`EXPLAIN (FORMAT JSON)
          WITH terms AS (SELECT t.term AS term, t.idx AS idx FROM unnest(${sql.param(['frango', 'ovos'])}::text[]) WITH ORDINALITY AS t(term, idx))
          SELECT ri.recipe_id, t.idx FROM recipe_ingredient ri CROSS JOIN terms t
          WHERE ${sql.raw(`ri.raw_text_tsv_${cfg}`)} @@ websearch_to_tsquery(${sql.raw(`'${cfg}'::regconfig`)}, immutable_unaccent(t.term))`)
        out[cfg] = JSON.stringify([...rows])
      }
      return out
    })
    for (const cfg of RECIPE_TS_CONFIGS) {
      expect(plans[cfg]).toContain(`recipe_ingredient_raw_text_tsv_${cfg}_gin`)
      expect(plans[cfg]).toContain('Bitmap Index Scan')
    }
  })

  it('a estatística da expressão recipe_ts_config(original_locale) existe (estimativa por braço)', async () => {
    // Sem ela o planner estima 0,5% das Receitas por config e, com muitos termos, larga o GIN (16 termos num
    // acervo de 8 mil Receitas: 3,3 s sem, ~0,2 s com; relatório da auditoria, §6).
    const rows = await db().execute<{ expr: string }>(sql`
      SELECT pg_get_statisticsobjdef_expressions(oid)::text AS expr FROM pg_statistic_ext
      WHERE stxname = 'recipe_original_locale_ts_config_stx'`)
    expect(rows.map((r) => r.expr)).toEqual(['{recipe_ts_config(original_locale)}'])
  })
})

/**
 * A consulta ANTIGA da Despensa: a consulta de hoje com cada coluna gerada trocada pela expressão que ela
 * guarda (o que a consulta escrevia antes da 0076). Embrulha o `db` e reescreve cada `execute` (também os
 * de dentro da transação) antes de mandar. Conta as trocas, para o teste não passar no vácuo.
 */
const STORED_TO_LEGACY: Array<[string, string]> = [
  ['ri.raw_text_norm', legacyNormText('ri.raw_text')],
  ['it.nome_norm', legacyNormText('it.nome')],
]

function toLegacyQuery(q: SQLWrapper, seen: Set<string>): SQL {
  const { sql: text, params } = dialect.sqlToQuery(q.getSQL())
  let out = text
  for (const [col, expr] of STORED_TO_LEGACY) {
    if (out.includes(col)) seen.add(col)
    out = out.split(col).join(expr)
  }
  // Remonta com os mesmos parâmetros, na mesma ordem ($1, $2, ...): texto entre os marcadores vai cru.
  const parts = out.split(/\$(\d+)/)
  return sql.join(
    parts.map((p, i) => (i % 2 === 0 ? sql.raw(p) : sql.param(params[Number(p) - 1]))),
    sql``,
  )
}

function legacyPantryDb(target: Database, seen: Set<string>): Database {
  const wrap = <T extends object>(d: T): T =>
    new Proxy(d, {
      get(t, prop, recv) {
        const value = Reflect.get(t, prop, recv)
        if (prop === 'execute') return (q: SQLWrapper) => (value as (q: SQL) => unknown).call(t, toLegacyQuery(q, seen))
        if (prop === 'transaction') {
          return (cb: (tx: unknown) => unknown, cfg?: unknown) =>
            (value as (cb: (tx: object) => unknown, cfg?: unknown) => unknown).call(t, (tx: object) => cb(wrap(tx)), cfg)
        }
        return value
      },
    })
  return wrap(target)
}

/** Captura o SQL que a Despensa manda (para conferir que lê as colunas, e não a expressão). */
function capturingDb(target: Database, texts: string[]): Database {
  const wrap = <T extends object>(d: T): T =>
    new Proxy(d, {
      get(t, prop, recv) {
        const value = Reflect.get(t, prop, recv)
        if (prop === 'execute') {
          return (q: SQLWrapper) => {
            texts.push(dialect.sqlToQuery(q.getSQL()).sql)
            return (value as (q: SQLWrapper) => unknown).call(t, q)
          }
        }
        if (prop === 'transaction') {
          return (cb: (tx: unknown) => unknown, cfg?: unknown) =>
            (value as (cb: (tx: object) => unknown, cfg?: unknown) => unknown).call(t, (tx: object) => cb(wrap(tx)), cfg)
        }
        return value
      },
    })
  return wrap(target)
}

const PANTRIES: string[][] = [
  ['Frango', 'ovos', 'Cebola Roxa', 'tomates cereja', 'Pimenta-do-Reino', 'ＦＡＲＩＮＨＡ', 'creme brulee', 'Jalapeno'],
  ['cafe', 'pão', 'limao', 'oleo', 'acucar', 'agua de coco', 'chicken', 'eggs', 'Translated FRANGO'],
  ['ovo', 'chef', 'cozido', 'cacau', 'a b', 'file', 'strasse', 'oeufs', 'sal', 'agua'],
  ['Black pepper', 'egg', 'farinha de trigo'],
]

describe('achado E — casamento da Despensa nas colunas normalizadas geradas', () => {
  it('mesma resposta que a consulta antiga, em várias despensas, com e sem básicos, nos três locales', async () => {
    const { ownerId } = await seedCorpus()
    const seen = new Set<string>()
    const legacy = legacyPantryDb(db(), seen)
    let nonEmpty = 0
    for (const names of PANTRIES) {
      const userId = await seedUser({ email: `desp-${crypto.randomUUID()}@ex.com` })
      expect((await applyAddPantryItems({ db: db(), userId, names })).kind).toBe('ok')
      for (const viewer of [userId, ownerId]) {
        if (viewer === ownerId) await applyAddPantryItems({ db: db(), userId: ownerId, names })
        for (const basics of [true, false]) {
          for (const requestLocale of ['pt-BR', 'en-US', 'es-ES']) {
            const args = { userId: viewer, basics, requestLocale, fallbackName: 'Sem nome' }
            const before = await loadPantryMatches({ db: legacy, ...args })
            const after = await loadPantryMatches({ db: db(), ...args })
            expect(after, JSON.stringify({ names, viewer, basics, requestLocale })).toEqual(before)
            if (before.length > 0) nonEmpty++
          }
        }
      }
    }
    // As duas colunas foram de fato trocadas na consulta "antiga" (senão a comparação seria vazia).
    expect([...seen].sort()).toEqual(['it.nome_norm', 'ri.raw_text_norm'])
    expect(nonEmpty).toBeGreaterThanOrEqual(30)
  })

  it('a consulta lê raw_text_norm e nome_norm, sem normalizar o texto do Item nem o nome do canônico', async () => {
    await seedCorpus()
    const userId = await seedUser({ email: `cap-${crypto.randomUUID()}@ex.com` })
    await applyAddPantryItems({ db: db(), userId, names: ['Frango'] })
    const texts: string[] = []
    await loadPantryMatches({ db: capturingDb(db(), texts), userId, basics: true, requestLocale: 'en-US', fallbackName: 'x' })
    const match = texts.find((t) => t.includes('real_line_hits'))
    expect(match).toBeDefined()
    expect(match).toContain('ri.raw_text_norm AS raw_n')
    expect(match).toContain('it.nome_norm AS n')
    expect(match).not.toContain('immutable_unaccent(ri.raw_text)')
    expect(match).not.toContain('immutable_unaccent(it.nome)')
    // O nome traduzido (jsonb de recipe_translation) segue normalizado na consulta, como antes.
    expect(match).toContain(legacyNormText('tr.nome'))
  })
})

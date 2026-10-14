import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { mealPlanEntry, pantryItem, recipe, recipeImage, shoppingList, shoppingListItem, users } from '@/db/schema'
import { normalizeOneLineText } from '@/domain/meal-plan'
import {
  MAX_PANTRY_ITEMS,
  PANTRY_MATCH_LIMIT,
  PANTRY_MAX_MISSING,
  PANTRY_NAME_MAX,
  pantryMatchKey,
  parsePantryName,
  resolvePantryBasics,
  splitCookedPantryItems,
} from '@/domain/pantry'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { RECIPE_LIST_COLS, hydrateRecipeListItems } from '@/server/recipe/collections'
import { poolBarriersSqlFragment, viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import { applyAddRecipeLinesToShoppingList, ensureDefaultShoppingList } from '@/server/shopping-list/shopping-list'

/**
 * Núcleo com efeito da Despensa (ADR-0038). Mesma disciplina da Lista de compras e do Cardápio: `db` por
 * parâmetro, discriminated unions que as rotas mapeiam a HTTP, e PRIVACIDADE por construção — toda função
 * escopa por `pantry_item.user_id = userId`; "não é seu" e "não existe" colapsam no MESMO `not_found`.
 *
 * O CASAMENTO com as Receitas (`loadPantryMatches`, dec.2) é UMA query SQL crua parametrizada (como a Busca):
 * nomes e básicos entram como `text[]` bindados, nunca interpolados.
 *
 * ADR-0042: os básicos são da pessoa (`users.pantry_basics`, NULL = a lista padrão) e o "Cozinhei" do Cardápio
 * (`applyCookedMealToPantry`) tira da Despensa o que a Receita usa pelo MESMO casamento, nunca os básicos.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────────

export type PantryItemView = { id: string; nome: string; createdAt: string }

export type PantryAddResult = { kind: 'ok'; added: PantryItemView[]; existing: number } | { kind: 'limit_reached' }

export type PantryRemoveResult = { kind: 'ok' } | { kind: 'not_found' }

/** Uma Receita casada com a Despensa: o card de lista + a contagem + os nomes do que falta. */
export type PantryMatch = Pick<
  RecipeListItem,
  'id' | 'name' | 'slug' | 'imageUrl' | 'imageSrcSet' | 'imageAiGenerated'
> & {
  total: number
  covered: number
  missing: string[]
}

export type PantryMissingToListResult =
  | { kind: 'ok'; listId: string; listName: string; addedLines: number }
  | { kind: 'not_found' }
  | { kind: 'nothing_missing' }

/** Os básicos efetivos da pessoa e se ela já trocou a lista padrão (ADR-0042 dec.4). */
export type PantryBasicsView = { basics: readonly string[]; custom: boolean }

/**
 * "Cozinhei" (ADR-0042): o que saiu da Despensa (vazio = nada da Despensa bateu com a Receita, ou já tinha
 * saído) e os itens que bateram mas FICARAM por serem básicos da pessoa.
 */
export type PantryCookedResult =
  | { kind: 'ok'; removed: PantryItemView[]; keptBasics: string[] }
  | { kind: 'not_found' }
  /** A entrada é uma Anotação (ADR-0037): não há Receita, não há o que tirar. */
  | { kind: 'no_recipe' }

export type PantryFromCheckedResult =
  | { kind: 'ok'; added: number; existing: number }
  | { kind: 'not_found' }
  | { kind: 'nothing_checked' }
  | { kind: 'limit_reached' }

// ── Ler / escrever a Despensa ────────────────────────────────────────────────────

/** Os itens da Despensa do Usuário, em ordem alfabética da chave (o que a tela lista em chips). */
export async function loadPantry(input: { db: Database; userId: string }): Promise<PantryItemView[]> {
  const rows = await input.db
    .select({
      id: pantryItem.id,
      nome: pantryItem.nome,
      createdAt: pantryItem.createdAt,
    })
    .from(pantryItem)
    .where(eq(pantryItem.userId, input.userId))
    .orderBy(asc(pantryItem.matchKey))
    .limit(MAX_PANTRY_ITEMS)
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    createdAt: r.createdAt.toISOString(),
  }))
}

/**
 * Adiciona nomes JÁ validados (`splitPantryInput`) à Despensa. Idempotente: um nome cuja chave já existe
 * não duplica (conta em `existing`). Teto: se os NOVOS passariam de `MAX_PANTRY_ITEMS`, nada é gravado
 * (`limit_reached`) — gravar só uma parte deixaria a pessoa sem saber o que ficou de fora. Numa transação
 * com um advisory lock por Usuário: dois "adicionar" paralelos não furam o teto.
 */
export async function applyAddPantryItems(input: {
  db: Database
  userId: string
  names: readonly string[]
}): Promise<PantryAddResult> {
  const { db, userId, names } = input
  const byKey = new Map<string, string>()
  for (const n of names) {
    const key = pantryMatchKey(n)
    if (key.length > 0 && !byKey.has(key)) byKey.set(key, n)
  }
  if (byKey.size === 0) return { kind: 'ok', added: [], existing: 0 }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'pantry:' + userId}, 0))`)
    const present = await tx
      .select({ matchKey: pantryItem.matchKey })
      .from(pantryItem)
      .where(eq(pantryItem.userId, userId))
    const presentKeys = new Set(present.map((p) => p.matchKey))
    const fresh = [...byKey].filter(([key]) => !presentKeys.has(key))
    if (presentKeys.size + fresh.length > MAX_PANTRY_ITEMS) return { kind: 'limit_reached' as const }
    if (fresh.length === 0) return { kind: 'ok' as const, added: [], existing: byKey.size }

    const inserted = await tx
      .insert(pantryItem)
      .values(fresh.map(([matchKey, nome]) => ({ userId, nome, matchKey })))
      .onConflictDoNothing({ target: [pantryItem.userId, pantryItem.matchKey] })
      .returning({
        id: pantryItem.id,
        nome: pantryItem.nome,
        createdAt: pantryItem.createdAt,
      })
    return {
      kind: 'ok' as const,
      added: inserted.map((r) => ({
        id: r.id,
        nome: r.nome,
        createdAt: r.createdAt.toISOString(),
      })),
      existing: byKey.size - inserted.length,
    }
  })
}

/** Tira UM item da Despensa do próprio Usuário. Vazio ⇒ `not_found` (não é seu / não existe). */
export async function applyRemovePantryItem(input: {
  db: Database
  userId: string
  itemId: string
}): Promise<PantryRemoveResult> {
  const [row] = await input.db
    .delete(pantryItem)
    .where(and(eq(pantryItem.id, input.itemId), eq(pantryItem.userId, input.userId)))
    .returning({ id: pantryItem.id })
  return row ? { kind: 'ok' } : { kind: 'not_found' }
}

/** Esvazia a Despensa do Usuário (ação explícita "Limpar despensa"). */
export async function applyClearPantry(input: { db: Database; userId: string }): Promise<{ removed: number }> {
  const rows = await input.db
    .delete(pantryItem)
    .where(eq(pantryItem.userId, input.userId))
    .returning({ id: pantryItem.id })
  return { removed: rows.length }
}

// ── Casamento com as Receitas (dec.2–4) ──────────────────────────────────────────

/**
 * Normalização SQL dos DOIS lados do casamento (termo e texto do Item): minúsculo, sem acento, e tudo que é
 * espaço ou pontuação vira UM espaço. Uma expressão só, aplicada ao nome da Despensa, aos básicos, aos nomes
 * e aliases do canônico e ao texto do Item — então "Pimenta-do-Reino" e "pimenta do reino" casam.
 *
 * O texto do Item e o nome do canônico não passam mais por aqui na consulta: vêm das colunas GERADAS
 * `recipe_ingredient.raw_text_norm` e `ingredient_translation.nome_norm` (migração 0076, achado E da
 * auditoria de performance), que gravam ESTA expressão na escrita. Mudou a expressão? Mude as duas colunas
 * numa migração (com a reescrita da tabela) no mesmo PR; a suíte
 * test/integration/ingredient-index-equivalence.test.ts compara as colunas com esta função linha a linha.
 * O nome traduzido (`tr.nome`, do jsonb de `recipe_translation`) segue normalizado aqui: coluna gerada não
 * alcança outra tabela (ver `lines`). Exportado só pra essa suíte.
 */
export function norm(expr: SQL): SQL {
  return sql`btrim(regexp_replace(lower(immutable_unaccent(${expr})), '[[:space:][:punct:]]+', ' ', 'g'))`
}

// Fragmentos constantes com barra invertida: via `String.raw` + `sql.raw` (num template do `sql` a barra
// seria um escape do JS). `standard_conforming_strings` está ligado no Postgres, então a barra chega literal.
/** Escapa metacaracteres de regex de um termo (defensivo: a normalização já só deixa letra/dígito/espaço). */
const ESC_TERM = sql.raw(String.raw`regexp_replace(term, '([.*+?^$(){}|\[\]\\])', '\\\1', 'g')`)
/** Singular da 1ª palavra do termo, plural em "-es" ("flores" → "flor"); radical de 3+ letras ("pães" fica). */
const SINGULAR_ES = sql.raw(String.raw`regexp_replace(term, '^([^ ]{3,})es( |$)', '\1\2')`)
/** Singular da 1ª palavra do termo, plural em "-s" ("ovos" → "ovo", "tomates cereja" → "tomate cereja"). */
const SINGULAR_S = sql.raw(String.raw`regexp_replace(term, '^([^ ]{3,})s( |$)', '\1\2')`)

/** Teto de tempo da consulta do casamento (medido: < 1 s com 4 mil Receitas e a Despensa cheia). */
const PANTRY_QUERY_TIMEOUT_MS = 5000
/** "Sem teto de faltando" (cabe no `integer` do bind; nenhuma Receita tem tantos Itens). */
const NO_MISSING_CAP = 100_000
/** Plural regular da 1ª palavra de um termo de várias ("tomate cereja" → "tomates cereja"); termo de uma palavra fica igual. */
const PLURAL_FIRST_S = sql.raw(String.raw`regexp_replace(t.term, '^([^ ]+) ', '\1s ')`)
const PLURAL_FIRST_ES = sql.raw(String.raw`regexp_replace(t.term, '^([^ ]+) ', '\1es ')`)

type MatchRow = {
  recipe_id: string
  total: number
  covered: number
  missing_ids: string[] | null
  missing_names: string[] | null
  /** Ids dos itens REAIS da Despensa que cobrem algum Item da Receita (só com `withUsed`; senão `null`). */
  used_ids: string[] | null
}

/** Um item da Despensa como entra no casamento: o id (pra saber QUAL item cobriu) e o nome. */
type PantryTerm = { id: string; nome: string }

/**
 * O casamento em si (dec.2–4), numa query só. Etapas (CTEs):
 *  1. `src`: os nomes da Despensa (`basic=false`) e, com "Tenho o básico", os básicos da pessoa
 *     (`basic=true`). Com `withUsed`, cada nome leva o id do item em `origin` (nulo nos básicos), e a coluna
 *     viaja por todas as etapas dos termos reais: é o que diz QUAL item cobriu cada linha (o "Cozinhei",
 *     ADR-0042).
 *  2. `canon`: o Ingrediente canônico que cada termo resolve — nome OU alias, qualquer locale, igualdade da
 *     forma normalizada (como a Busca #9: "cebola" não resolve "cebola roxa").
 *  3. `terms`: o termo + os nomes/aliases (todos os locales) do canônico que ele resolveu; e, para plural na
 *     PRIMEIRA palavra do termo ("ovos", "tomates cereja"), o singular ("ovo", "tomate cereja") — só com
 *     radical de 3+ letras, pra "pães" não virar "pa".
 *  4. `real_forms` (termos REAIS): cada termo vira as formas aceitas no Item — o próprio termo, `+s`, `+es` e o
 *     plural da primeira palavra ("tomate cereja" → "tomates cereja") — já quebradas em palavras, com a
 *     PRIMEIRA separada (`first_word`) para o JOIN de igualdade. `basic_pattern` (só básicos): UMA regex
 *     ancorada na LINHA INTEIRA feita de básicos ("sal", "sal e pimenta do reino", "sal a gosto") — senão
 *     "água" cobriria "água de coco". Os termos já estão normalizados, e mesmo assim são escapados.
 *  5. `lines`: os Itens com nome das Receitas que o viewer pode SALVAR (o gate de `eligibleToSaveByViewer`
 *     em SQL: leitura do viewer + barreiras do pool — o mesmo da Sugestão de cardápio), com o texto
 *     normalizado: `raw_text` (locale de origem; lido da coluna gerada `raw_text_norm`) e o nome traduzido
 *     do locale do viewer, só quando ainda casa com o `raw_text` (ADR-0030; normalizado UMA vez aqui). Item
 *     sem `raw_text` fica de fora: sem nome, não há o que mostrar como faltando nem o que pôr na lista.
 *  6. `tokens` + `real_line_hits` + `hits`: cada linha vira palavras; um termo real cobre a linha quando a
 *     primeira palavra dele é IGUAL a uma palavra da linha e a fatia seguinte do array bate com o resto
 *     (palavra(s) inteira(s) em qualquer ponto: "farinha" cobre "farinha de trigo", "sal" não cobre
 *     "salsinha"). Também cobre por canônico igual; básico cobre pela `basic_pattern`. Sem regex por termo
 *     real: foi o que levava ~10 s num acervo de 4.000 Receitas.
 *  7. `per_recipe`: total, cobertos, cobertos por item REAL, e os ids/nomes do que falta.
 * Filtro final: ao menos um Item coberto por item real (dec.3) e no máximo `maxMissing` faltando.
 *
 * `onlyRecipeId` restringe a UMA Receita (o "pôr o que falta na lista" recalcula no servidor, dec.5a; o
 * "Cozinhei" também, ADR-0042). `withUsed` devolve em `used_ids` os itens REAIS que cobrem algum Item (por
 * palavra ou por canônico) — só o "Cozinhei" pede; a lista de resultados não paga por isso.
 */
async function queryPantryMatches(input: {
  db: Database
  userId: string
  items: readonly PantryTerm[]
  /** Os básicos efetivos da pessoa com "Tenho o básico" ligado; `[]` com a opção desligada. */
  basics: readonly string[]
  locale: string
  maxMissing: number
  limit: number
  onlyRecipeId?: string
  withUsed?: boolean
}): Promise<MatchRow[]> {
  const { db, userId, items, basics, locale, maxMissing, limit, onlyRecipeId, withUsed } = input
  if (items.length === 0) return []
  const recipeFilter = onlyRecipeId !== undefined ? sql`AND r.id = ${onlyRecipeId}` : sql``
  // Os itens REAIS que cobrem algum Item de cada Receita, por palavra (`real_token_hits`) ou pelo canônico — a
  // mesma regra de `real_hit`. Só o "Cozinhei" pede (sempre com UMA Receita): sem `withUsed`, a CTE nem entra na
  // query.
  const usedCte = withUsed
    ? sql`used AS (
      SELECT x.recipe_id, array_agg(DISTINCT x.origin ORDER BY x.origin) AS ids
      FROM (
        SELECT l.recipe_id, th.origin FROM real_token_hits th JOIN lines l ON l.line_id = th.line_id
        UNION ALL
        SELECT l.recipe_id, c.origin FROM lines l JOIN canon c ON c.ingredient_id = l.ingredient_id
        WHERE NOT c.basic
      ) x
      GROUP BY x.recipe_id
    ),`
    : sql``
  const usedIds = withUsed
    ? sql`(SELECT u.ids FROM used u WHERE u.recipe_id = pr.recipe_id)`
    : sql`NULL::uuid[]`
  // A coluna `origin` (o id do item da Despensa; nula nos básicos) só existe com `withUsed`: sem ela, cada CTE
  // dos termos é EXATAMENTE a de antes do ADR-0042 (medido: carregar a coluna, mesmo nula, deixava a lista de
  // resultados ~10% mais lenta no acervo sintético do handoff 60).
  const originCol = withUsed ? sql`, origin` : sql``
  const basicOrigin = withUsed ? sql`, NULL::uuid` : sql``
  const srcItems = withUsed
    ? sql`SELECT n.name AS name, false AS basic, n.origin AS origin
      FROM unnest(${sql.param(items.map((i) => i.id))}::uuid[], ${sql.param(items.map((i) => i.nome))}::text[])
        AS n(origin, name)`
    : sql`SELECT n.name AS name, false AS basic
      FROM unnest(${sql.param(items.map((i) => i.nome))}::text[]) AS n(name)`

  // Teto de tempo da consulta: um acervo que cresça além do previsto vira erro (500) em vez de segurar uma
  // conexão do pool. `SET LOCAL` só vale dentro da transação.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = ${sql.raw(`'${PANTRY_QUERY_TIMEOUT_MS}ms'`)}`)
    const rows = await tx.execute<MatchRow>(sql`
    WITH src AS (
      ${srcItems}
      UNION ALL
      SELECT b.name, true${basicOrigin} FROM unnest(${sql.param([...basics])}::text[]) AS b(name)
    ),
    src_norm AS (
      SELECT DISTINCT ${norm(sql`s.name`)} AS term, s.basic AS basic${originCol} FROM src s
    ),
    it_names AS MATERIALIZED (
      -- Nomes e aliases de TODOS os Ingredientes canônicos, normalizados UMA vez: o join abaixo vira igualdade
      -- simples (hash join), sem recalcular a normalização por par (termo × tradução × alias). O nome vem
      -- da coluna gerada nome_norm (a mesma normalização, gravada na escrita); os aliases, normalizados aqui.
      SELECT it.ingredient_id, it.nome_norm AS n FROM ingredient_translation it
      UNION ALL
      SELECT it.ingredient_id, ${norm(sql`a.alias`)}
      FROM ingredient_translation it CROSS JOIN LATERAL unnest(it.aliases) AS a(alias)
    ),
    canon AS (
      SELECT DISTINCT n.ingredient_id, s.basic${originCol}
      FROM src_norm s JOIN it_names n ON n.n = s.term
      WHERE s.term <> ''
    ),
    expanded AS (
      SELECT term, basic${originCol} FROM src_norm
      UNION
      SELECT n.n, c.basic${originCol} FROM canon c JOIN it_names n ON n.ingredient_id = c.ingredient_id
    ),
    terms AS (
      SELECT term, basic${originCol} FROM expanded
      UNION
      SELECT ${SINGULAR_ES}, basic${originCol} FROM expanded
      UNION
      SELECT ${SINGULAR_S}, basic${originCol} FROM expanded
    ),
    real_forms AS (
      -- As formas que casam o texto do Item: o termo, o plural regular da ÚLTIMA palavra ("ovo" → "ovos",
      -- "farinha" → "farinhas") e o da PRIMEIRA ("tomate cereja" → "tomates cereja"), com a 1ª palavra e o
      -- número de palavras já separados (o join abaixo casa pela 1ª palavra e só então confere o resto).
      SELECT DISTINCT f.form AS form, split_part(f.form, ' ', 1) AS first_word,
        array_length(string_to_array(f.form, ' '), 1) AS n_words${originCol}
      FROM terms t
      CROSS JOIN LATERAL (
        VALUES (t.term), (t.term || 's'), (t.term || 'es'), (${PLURAL_FIRST_S}), (${PLURAL_FIRST_ES})
      ) AS f(form)
      WHERE NOT t.basic AND t.term <> ''
    ),
    basic_pattern AS (
      -- Básico: só a LINHA INTEIRA feita de básicos, separados por espaço (a vírgula já virou espaço), "e",
      -- "and", "ou" ou "or", com "a gosto"/"to taste"/"q.b." no fim. Regex pequena (no máximo os 30 básicos da
      -- pessoa, ADR-0042 dec.4, mais as expansões pelo canônico), ancorada no começo: falha rápido. Os termos já são só letras/dígitos/espaço; escapados mesmo assim.
      SELECT
        '^(' || string_agg(${ESC_TERM}, '|') || ')(e?s)?(( e | and | ou | or | )('
          || string_agg(${ESC_TERM}, '|') || ')(e?s)?)*( a gosto| to taste| q b)?$' AS re
      FROM terms
      WHERE basic AND term <> ''
    ),
    canon_ids AS (
      SELECT
        COALESCE(array_agg(ingredient_id) FILTER (WHERE NOT basic), '{}'::uuid[]) AS real_ids,
        COALESCE(array_agg(ingredient_id) FILTER (WHERE basic), '{}'::uuid[]) AS basic_ids
      FROM canon
    ),
    lines AS MATERIALIZED (
      SELECT
        ri.id AS line_id,
        ri.recipe_id AS recipe_id,
        ri.ordem AS ordem,
        ri.ingredient_id AS ingredient_id,
        COALESCE(tr.nome, btrim(ri.raw_text)) AS display_name,
        ri.raw_text_norm AS raw_n,
        ${norm(sql`tr.nome`)} AS tr_n
      FROM recipe_ingredient ri
      JOIN recipe r ON r.id = ri.recipe_id
      LEFT JOIN recipe_translation rt ON rt.recipe_id = r.id AND rt.locale = ${locale}
      LEFT JOIN LATERAL (
        SELECT e->>'nome' AS nome
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(rt.ingredientes) = 'array' THEN rt.ingredientes ELSE '[]'::jsonb END
        ) AS e
        WHERE e->>'ordem' = ri.ordem::text
          AND e->>'nomeOrigem' = ri.raw_text
          AND btrim(COALESCE(e->>'nome', '')) <> ''
        LIMIT 1
      ) tr ON true
      WHERE btrim(COALESCE(ri.raw_text, '')) <> ''
        AND ${viewerReadableSqlFragment('r', userId)}
        AND ${poolBarriersSqlFragment('r')}
        ${recipeFilter}
    ),
    tokens AS (
      -- Cada palavra do texto normalizado de cada Item (origem e tradução), com a posição. "Palavra(s)
      -- inteira(s)" vira: a 1ª palavra da forma é IGUAL a uma palavra do Item (hash join) e as seguintes batem
      -- em sequência — em vez de uma regex com centenas de alternativas avaliada em cada linha.
      SELECT l.line_id, w.arr, t.word, t.pos
      FROM lines l
      CROSS JOIN LATERAL (VALUES (string_to_array(l.raw_n, ' ')), (string_to_array(l.tr_n, ' '))) AS w(arr)
      CROSS JOIN LATERAL unnest(w.arr) WITH ORDINALITY AS t(word, pos)
    ),
    real_token_hits AS (
      -- (linha, item da Despensa) que casam por palavra; real_line_hits é só a linha.
      SELECT DISTINCT tk.line_id${originCol}
      FROM tokens tk
      JOIN real_forms f ON f.first_word = tk.word
      WHERE f.n_words = 1
        OR array_to_string(tk.arr[tk.pos:tk.pos + f.n_words - 1], ' ') = f.form
    ),
    real_line_hits AS (
      SELECT DISTINCT line_id FROM real_token_hits
    ),
    ${usedCte}
    hits AS MATERIALIZED (
      SELECT
        l.line_id,
        l.recipe_id,
        l.ordem,
        l.display_name,
        (l.ingredient_id = ANY (ci.real_ids) OR rh.line_id IS NOT NULL) IS TRUE AS real_hit,
        (
          l.ingredient_id = ANY (ci.basic_ids)
          OR COALESCE(l.raw_n ~ bp.re, false)
          OR COALESCE(l.tr_n ~ bp.re, false)
        ) IS TRUE AS basic_hit
      FROM lines l
      CROSS JOIN canon_ids ci
      CROSS JOIN basic_pattern bp
      LEFT JOIN real_line_hits rh ON rh.line_id = l.line_id
    ),
    per_recipe AS (
      SELECT
        h.recipe_id,
        count(*)::int AS total,
        (count(*) FILTER (WHERE h.real_hit OR h.basic_hit))::int AS covered,
        (count(*) FILTER (WHERE h.real_hit))::int AS real_covered,
        array_agg(h.line_id ORDER BY h.ordem, h.line_id) FILTER (WHERE NOT (h.real_hit OR h.basic_hit)) AS missing_ids,
        array_agg(h.display_name ORDER BY h.ordem, h.line_id) FILTER (WHERE NOT (h.real_hit OR h.basic_hit)) AS missing_names
      FROM hits h
      GROUP BY h.recipe_id
    )
    SELECT pr.recipe_id, pr.total, pr.covered, pr.missing_ids, pr.missing_names, ${usedIds} AS used_ids
    FROM per_recipe pr
    JOIN recipe r ON r.id = pr.recipe_id
    WHERE pr.real_covered >= 1
      AND pr.total - pr.covered <= ${maxMissing}
    ORDER BY pr.total - pr.covered ASC, pr.real_covered DESC, r.created_at DESC, pr.recipe_id
    LIMIT ${limit}
  `)
    return [...rows]
  })
}

/** Os itens da Despensa do Usuário (o que alimenta o casamento): id + nome. */
async function loadPantryTerms(db: Database, userId: string): Promise<PantryTerm[]> {
  return db
    .select({ id: pantryItem.id, nome: pantryItem.nome })
    .from(pantryItem)
    .where(eq(pantryItem.userId, userId))
    .orderBy(asc(pantryItem.matchKey))
    .limit(MAX_PANTRY_ITEMS)
}

// ── Básicos por pessoa (ADR-0042 dec.4) ──────────────────────────────────────────

/** A lista guardada (`null` = nunca mexeu). */
async function loadStoredBasics(db: Database, userId: string): Promise<string[] | null> {
  const [row] = await db.select({ basics: users.pantryBasics }).from(users).where(eq(users.id, userId))
  return row?.basics ?? null
}

/** Os básicos efetivos da pessoa (a lista dela ou a padrão) e se ela já trocou a padrão. */
export async function loadPantryBasics(input: { db: Database; userId: string }): Promise<PantryBasicsView> {
  const stored = await loadStoredBasics(input.db, input.userId)
  return { basics: resolvePantryBasics(stored), custom: stored !== null }
}

/**
 * Grava os básicos da pessoa — já validados (`parsePantryBasics`) — ou `null` para voltar à lista padrão.
 * Devolve o estado efetivo depois da escrita.
 */
export async function applySetPantryBasics(input: {
  db: Database
  userId: string
  basics: readonly string[] | null
}): Promise<PantryBasicsView> {
  const { db, userId, basics } = input
  await db
    .update(users)
    .set({ pantryBasics: basics === null ? null : [...basics], updatedAt: new Date() })
    .where(eq(users.id, userId))
  return { basics: resolvePantryBasics(basics), custom: basics !== null }
}

/** Os básicos que entram no casamento: os da pessoa com a opção ligada; nenhum com ela desligada. */
async function basicsForMatching(db: Database, userId: string, on: boolean): Promise<readonly string[]> {
  return on ? resolvePantryBasics(await loadStoredBasics(db, userId)) : []
}

/**
 * "O que dá pra fazer" (dec.4): as Receitas legíveis ao viewer com no máximo `PANTRY_MAX_MISSING` Itens
 * faltando, ordenadas pelo que falta. O card é o MESMO de Salvos/Cardápio (`hydrateRecipeListItems`:
 * título por locale, slug, thumbnail sem imagem moderada). Despensa vazia ⇒ lista vazia.
 */
export async function loadPantryMatches(input: {
  db: Database
  userId: string
  basics: boolean
  requestLocale: string
  fallbackName: string
}): Promise<PantryMatch[]> {
  const { db, userId, requestLocale, fallbackName } = input
  const [items, basics] = await Promise.all([
    loadPantryTerms(db, userId),
    basicsForMatching(db, userId, input.basics),
  ])
  if (items.length === 0) return []
  const matches = await queryPantryMatches({
    db,
    userId,
    items,
    basics,
    locale: requestLocale,
    maxMissing: PANTRY_MAX_MISSING,
    limit: PANTRY_MATCH_LIMIT,
  })
  if (matches.length === 0) return []

  const baseRows = await db
    .select({ ...RECIPE_LIST_COLS })
    .from(recipe)
    .leftJoin(recipeImage, and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)))
    .where(
      inArray(
        recipe.id,
        matches.map((m) => m.recipe_id),
      ),
    )
  const cards = await hydrateRecipeListItems(db, baseRows, requestLocale, fallbackName)
  const cardById = new Map(cards.map((c) => [c.id, c]))

  const out: PantryMatch[] = []
  for (const m of matches) {
    const card = cardById.get(m.recipe_id)
    if (!card) continue
    out.push({
      id: card.id,
      name: card.name,
      ...(card.slug !== undefined ? { slug: card.slug } : {}),
      ...(card.imageUrl !== undefined ? { imageUrl: card.imageUrl } : {}),
      ...(card.imageSrcSet !== undefined ? { imageSrcSet: card.imageSrcSet } : {}),
      ...(card.imageAiGenerated ? { imageAiGenerated: true } : {}),
      total: m.total,
      covered: m.covered,
      missing: m.missing_names ?? [],
    })
  }
  return out
}

// ── Pontes (dec.5a e dec.6) ──────────────────────────────────────────────────────

/**
 * "Pôr o que falta na lista" (dec.5a): o servidor RECALCULA o que falta da Receita contra a Despensa atual
 * (com a mesma opção de básicos da tela) e adiciona SÓ esses Itens, na base, à Lista indicada (do próprio
 * Usuário) ou à lista-padrão. Receita que não casa mais (ilegível, ou nada da Despensa cobre) ⇒ `not_found`;
 * nada faltando ⇒ `nothing_missing`. Sem teto de "faltando" aqui: a pessoa pode ter aberto a tela antes de
 * tirar um item da Despensa, e o que falta agora ainda é o que ela quer comprar.
 */
export async function applyPantryMissingToShoppingList(input: {
  db: Database
  userId: string
  recipeId: string
  basics: boolean
  locale: string
  listId?: string
}): Promise<PantryMissingToListResult> {
  const { db, userId, recipeId, locale } = input
  const [items, basics] = await Promise.all([
    loadPantryTerms(db, userId),
    basicsForMatching(db, userId, input.basics),
  ])
  const [match] = await queryPantryMatches({
    db,
    userId,
    items,
    basics,
    locale,
    maxMissing: NO_MISSING_CAP, // sem teto aqui: o que falta agora é o que se quer comprar
    limit: 1,
    onlyRecipeId: recipeId,
  })
  if (!match) return { kind: 'not_found' }
  const missing = match.missing_ids ?? []
  if (missing.length === 0) return { kind: 'nothing_missing' }

  let list: { id: string; name: string }
  if (input.listId !== undefined) {
    const [own] = await db
      .select({ id: shoppingList.id, name: shoppingList.name })
      .from(shoppingList)
      .where(and(eq(shoppingList.id, input.listId), eq(shoppingList.userId, userId)))
    if (!own) return { kind: 'not_found' }
    list = own
  } else {
    list = await ensureDefaultShoppingList({ db, userId })
  }

  const res = await applyAddRecipeLinesToShoppingList({
    db,
    userId,
    listId: list.id,
    recipeId,
    locale,
    lineIds: new Set(missing),
  })
  if (res.kind === 'not_found') return res
  return {
    kind: 'ok',
    listId: list.id,
    listName: list.name,
    addedLines: res.addedLines,
  }
}

/**
 * "Cozinhei" numa Refeição planejada (ADR-0042 dec.1–3): tira da Despensa os itens que cobrem algum Item da
 * Receita daquela entrada, pelo MESMO casamento do "o que dá pra fazer" (`queryPantryMatches` com
 * `withUsed`, restrito à Receita), e nunca os básicos da pessoa. Tudo recalculado no servidor a partir do
 * id da entrada: o cliente não diz nem a Receita nem os nomes. Idempotente sem estado gravado: o segundo
 * toque não acha mais os itens e devolve `removed: []`.
 *
 * Os básicos ficam FORA do casamento aqui: eles só cobrem linhas e nunca saem; o que importa é qual item
 * REAL cobre, e isso não depende da opção "Tenho o básico". Receita que ficou inelegível (o mesmo gate de
 * Salvar do casamento) não casa: `removed: []`, como "nada bateu".
 */
export async function applyCookedMealToPantry(input: {
  db: Database
  userId: string
  entryId: string
  locale: string
}): Promise<PantryCookedResult> {
  const { db, userId, entryId, locale } = input
  const [entry] = await db
    .select({ recipeId: mealPlanEntry.recipeId })
    .from(mealPlanEntry)
    .where(and(eq(mealPlanEntry.id, entryId), eq(mealPlanEntry.userId, userId)))
  if (!entry) return { kind: 'not_found' }
  if (entry.recipeId == null) return { kind: 'no_recipe' }

  const [items, { basics }] = await Promise.all([loadPantryTerms(db, userId), loadPantryBasics({ db, userId })])
  const [match] = await queryPantryMatches({
    db,
    userId,
    items,
    basics: [],
    locale,
    maxMissing: NO_MISSING_CAP, // tudo que a Receita usa, por mais que falte
    limit: 1,
    onlyRecipeId: entry.recipeId,
    withUsed: true,
  })
  const usedIds = match?.used_ids ?? []
  if (usedIds.length === 0) return { kind: 'ok', removed: [], keptBasics: [] }

  const { remove, keptBasics } = splitCookedPantryItems(items, usedIds, basics)
  const kept = keptBasics.map((k) => k.nome)
  if (remove.length === 0) return { kind: 'ok', removed: [], keptBasics: kept }

  // Escopado pelo dono de novo (defesa em profundidade) e pelo que ainda existe: um item tirado à mão no
  // meio do caminho não volta no "Desfazer" porque não aparece aqui.
  const deleted = await db
    .delete(pantryItem)
    .where(
      and(
        eq(pantryItem.userId, userId),
        inArray(
          pantryItem.id,
          remove.map((r) => r.id),
        ),
      ),
    )
    .returning({ id: pantryItem.id, nome: pantryItem.nome, createdAt: pantryItem.createdAt })
  const removed = deleted
    .map((r) => ({ id: r.id, nome: r.nome, createdAt: r.createdAt.toISOString() }))
    .sort((a, b) => (pantryMatchKey(a.nome) < pantryMatchKey(b.nome) ? -1 : 1)) // a ordem dos chips
  return { kind: 'ok', removed, keptBasics: kept }
}

/**
 * "Guardar marcados na despensa" (dec.6): copia os NOMES dos itens marcados de uma Lista do próprio Usuário
 * para a Despensa. Não mexe na Lista. Nome longo demais para a Despensa (a Lista aceita até 200) é cortado
 * no teto da Despensa; idempotente pela chave; o teto da Despensa vale (tudo ou nada, como o adicionar).
 */
export async function applyCheckedItemsToPantry(input: {
  db: Database
  userId: string
  listId: string
}): Promise<PantryFromCheckedResult> {
  const { db, userId, listId } = input
  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const checked = await db
    .select({ nome: shoppingListItem.nome })
    .from(shoppingListItem)
    .where(and(eq(shoppingListItem.listId, listId), isNotNull(shoppingListItem.checkedAt)))
  const names = checked.map((c) => toPantryName(c.nome)).filter((n): n is string => n !== null)
  if (names.length === 0) return { kind: 'nothing_checked' }

  const res = await applyAddPantryItems({ db, userId, names })
  if (res.kind === 'limit_reached') return res
  return { kind: 'ok', added: res.added.length, existing: res.existing }
}

/**
 * Nome de item da Lista → nome de item da Despensa (a Lista aceita até 200). Normaliza ANTES de cortar no teto
 * por code point: cortar primeiro contaria espaços repetidos e controles que a normalização some.
 */
function toPantryName(nome: string): string | null {
  const parsed = parsePantryName([...normalizeOneLineText(nome)].slice(0, PANTRY_NAME_MAX).join('').trim())
  return parsed === 'invalid' ? null : parsed
}

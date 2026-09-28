import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  pantryItem,
  recipe,
  recipeImage,
  shoppingList,
  shoppingListItem,
} from "@/db/schema";
import {
  MAX_PANTRY_ITEMS,
  PANTRY_BASICS,
  PANTRY_MATCH_LIMIT,
  PANTRY_MAX_MISSING,
  PANTRY_NAME_MAX,
  pantryMatchKey,
  parsePantryName,
} from "@/domain/pantry";
import type { RecipeListItem } from "@/domain/recipe-list-read";
import {
  RECIPE_LIST_COLS,
  hydrateRecipeListItems,
} from "@/server/recipe/collections";
import {
  poolBarriersSqlFragment,
  viewerReadableSqlFragment,
} from "@/server/recipe/visibility-sql";
import {
  applyAddRecipeLinesToShoppingList,
  ensureDefaultShoppingList,
} from "@/server/shopping-list/shopping-list";

/**
 * Núcleo com efeito da Despensa (ADR-0038). Mesma disciplina da Lista de compras e do Cardápio: `db` por
 * parâmetro, discriminated unions que as rotas mapeiam a HTTP, e PRIVACIDADE por construção — toda função
 * escopa por `pantry_item.user_id = userId`; "não é seu" e "não existe" colapsam no MESMO `not_found`.
 *
 * O CASAMENTO com as Receitas (`loadPantryMatches`, dec.2) é UMA query SQL crua parametrizada (como a Busca):
 * nomes e básicos entram como `text[]` bindados, nunca interpolados.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────────

export type PantryItemView = { id: string; nome: string; createdAt: string };

export type PantryAddResult =
  | { kind: "ok"; added: PantryItemView[]; existing: number }
  | { kind: "limit_reached" };

export type PantryRemoveResult = { kind: "ok" } | { kind: "not_found" };

/** Uma Receita casada com a Despensa: o card de lista + a contagem + os nomes do que falta. */
export type PantryMatch = Pick<
  RecipeListItem,
  "id" | "name" | "slug" | "imageUrl" | "imageAiGenerated"
> & {
  total: number;
  covered: number;
  missing: string[];
};

export type PantryMissingToListResult =
  | { kind: "ok"; listId: string; listName: string; addedLines: number }
  | { kind: "not_found" }
  | { kind: "nothing_missing" };

export type PantryFromCheckedResult =
  | { kind: "ok"; added: number; existing: number }
  | { kind: "not_found" }
  | { kind: "nothing_checked" }
  | { kind: "limit_reached" };

// ── Ler / escrever a Despensa ────────────────────────────────────────────────────

/** Os itens da Despensa do Usuário, em ordem alfabética da chave (o que a tela lista em chips). */
export async function loadPantry(input: {
  db: Database;
  userId: string;
}): Promise<PantryItemView[]> {
  const rows = await input.db
    .select({
      id: pantryItem.id,
      nome: pantryItem.nome,
      createdAt: pantryItem.createdAt,
    })
    .from(pantryItem)
    .where(eq(pantryItem.userId, input.userId))
    .orderBy(asc(pantryItem.matchKey))
    .limit(MAX_PANTRY_ITEMS);
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Adiciona nomes JÁ validados (`splitPantryInput`) à Despensa. Idempotente: um nome cuja chave já existe
 * não duplica (conta em `existing`). Teto: se os NOVOS passariam de `MAX_PANTRY_ITEMS`, nada é gravado
 * (`limit_reached`) — gravar só uma parte deixaria a pessoa sem saber o que ficou de fora. Numa transação
 * com um advisory lock por Usuário: dois "adicionar" paralelos não furam o teto.
 */
export async function applyAddPantryItems(input: {
  db: Database;
  userId: string;
  names: readonly string[];
}): Promise<PantryAddResult> {
  const { db, userId, names } = input;
  const byKey = new Map<string, string>();
  for (const n of names) {
    const key = pantryMatchKey(n);
    if (key.length > 0 && !byKey.has(key)) byKey.set(key, n);
  }
  if (byKey.size === 0) return { kind: "ok", added: [], existing: 0 };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"pantry:" + userId}, 0))`,
    );
    const present = await tx
      .select({ matchKey: pantryItem.matchKey })
      .from(pantryItem)
      .where(eq(pantryItem.userId, userId));
    const presentKeys = new Set(present.map((p) => p.matchKey));
    const fresh = [...byKey].filter(([key]) => !presentKeys.has(key));
    if (presentKeys.size + fresh.length > MAX_PANTRY_ITEMS)
      return { kind: "limit_reached" as const };
    if (fresh.length === 0)
      return { kind: "ok" as const, added: [], existing: byKey.size };

    const inserted = await tx
      .insert(pantryItem)
      .values(fresh.map(([matchKey, nome]) => ({ userId, nome, matchKey })))
      .onConflictDoNothing({ target: [pantryItem.userId, pantryItem.matchKey] })
      .returning({
        id: pantryItem.id,
        nome: pantryItem.nome,
        createdAt: pantryItem.createdAt,
      });
    return {
      kind: "ok" as const,
      added: inserted.map((r) => ({
        id: r.id,
        nome: r.nome,
        createdAt: r.createdAt.toISOString(),
      })),
      existing: byKey.size - inserted.length,
    };
  });
}

/** Tira UM item da Despensa do próprio Usuário. Vazio ⇒ `not_found` (não é seu / não existe). */
export async function applyRemovePantryItem(input: {
  db: Database;
  userId: string;
  itemId: string;
}): Promise<PantryRemoveResult> {
  const [row] = await input.db
    .delete(pantryItem)
    .where(
      and(eq(pantryItem.id, input.itemId), eq(pantryItem.userId, input.userId)),
    )
    .returning({ id: pantryItem.id });
  return row ? { kind: "ok" } : { kind: "not_found" };
}

/** Esvazia a Despensa do Usuário (ação explícita "Limpar despensa"). */
export async function applyClearPantry(input: {
  db: Database;
  userId: string;
}): Promise<{ removed: number }> {
  const rows = await input.db
    .delete(pantryItem)
    .where(eq(pantryItem.userId, input.userId))
    .returning({ id: pantryItem.id });
  return { removed: rows.length };
}

// ── Casamento com as Receitas (dec.2–4) ──────────────────────────────────────────

/**
 * Normalização SQL dos DOIS lados do casamento (termo e texto do Item): minúsculo, sem acento, e tudo que é
 * espaço ou pontuação vira UM espaço. Uma expressão só, aplicada ao nome da Despensa, aos básicos, aos nomes
 * e aliases do canônico e ao texto do Item — então "Pimenta-do-Reino" e "pimenta do reino" casam.
 */
function norm(expr: SQL): SQL {
  return sql`btrim(regexp_replace(lower(immutable_unaccent(${expr})), '[[:space:][:punct:]]+', ' ', 'g'))`;
}

// Fragmentos constantes com barra invertida: via `String.raw` + `sql.raw` (num template do `sql` a barra
// seria um escape do JS). `standard_conforming_strings` está ligado no Postgres, então a barra chega literal.
/** Escapa metacaracteres de regex de um termo (defensivo: a normalização já só deixa letra/dígito/espaço). */
const ESC_TERM = sql.raw(
  String.raw`regexp_replace(term, '([.*+?^$(){}|\[\]\\])', '\\\1', 'g')`,
);
/** Singular da 1ª palavra do termo, plural em "-es" ("flores" → "flor"); radical de 3+ letras ("pães" fica). */
const SINGULAR_ES = sql.raw(
  String.raw`regexp_replace(term, '^([^ ]{3,})es( |$)', '\1\2')`,
);
/** Singular da 1ª palavra do termo, plural em "-s" ("ovos" → "ovo", "tomates cereja" → "tomate cereja"). */
const SINGULAR_S = sql.raw(
  String.raw`regexp_replace(term, '^([^ ]{3,})s( |$)', '\1\2')`,
);

type MatchRow = {
  recipe_id: string;
  total: number;
  covered: number;
  missing_ids: string[] | null;
  missing_names: string[] | null;
};

/**
 * O casamento em si (dec.2–4), numa query só. Etapas (CTEs):
 *  1. `src`: os nomes da Despensa (`basic=false`) e, com "Tenho o básico", os básicos (`basic=true`).
 *  2. `canon`: o Ingrediente canônico que cada termo resolve — nome OU alias, qualquer locale, igualdade da
 *     forma normalizada (como a Busca #9: "cebola" não resolve "cebola roxa").
 *  3. `terms`: o termo + os nomes/aliases (todos os locales) do canônico que ele resolveu; e, para plural na
 *     PRIMEIRA palavra do termo ("ovos", "tomates cereja"), o singular ("ovo", "tomate cereja") — só com
 *     radical de 3+ letras, pra "pães" não virar "pa".
 *  4. `patterns`: UMA regex por tipo. Item real: `(^| )(t1|t2|…)(e?s)?( |$)` — palavra(s) inteira(s) em
 *     qualquer ponto do texto, aceitando o plural regular do Item ("ovo" cobre "ovos"; "farinha" cobre
 *     "farinha de trigo"). Básico: só a LINHA INTEIRA feita de básicos ("sal", "sal e pimenta do reino",
 *     "sal a gosto") — senão "água" cobriria "água de coco" e "óleo" cobriria "óleo de gergelim". Os termos
 *     já estão normalizados (letras, dígitos, espaço), e mesmo assim os metacaracteres são escapados.
 *  5. `lines`: os Itens com nome das Receitas que o viewer pode SALVAR (o gate de `eligibleToSaveByViewer`
 *     em SQL: leitura do viewer + barreiras do pool — o mesmo da Sugestão de cardápio), com o texto
 *     normalizado UMA vez: `raw_text` (locale de origem) e o nome traduzido do locale do viewer, só quando
 *     ainda casa com o `raw_text` (ADR-0030). Item sem `raw_text` fica de fora: sem nome, não há o que
 *     mostrar como faltando nem o que pôr na lista.
 *  6. `hits`: cada Item é coberto por um item real e/ou por um básico — canônico igual OU regex.
 *  7. `per_recipe`: total, cobertos, cobertos por item REAL, e os ids/nomes do que falta.
 * Filtro final: ao menos um Item coberto por item real (dec.3) e no máximo `maxMissing` faltando.
 *
 * `onlyRecipeId` restringe a UMA Receita (o "pôr o que falta na lista" recalcula no servidor, dec.5a).
 */
async function queryPantryMatches(input: {
  db: Database;
  userId: string;
  names: readonly string[];
  basics: boolean;
  locale: string;
  maxMissing: number;
  limit: number;
  onlyRecipeId?: string;
}): Promise<MatchRow[]> {
  const { db, userId, names, basics, locale, maxMissing, limit, onlyRecipeId } =
    input;
  if (names.length === 0) return [];
  const basicNames = basics ? [...PANTRY_BASICS] : [];
  const recipeFilter =
    onlyRecipeId !== undefined ? sql`AND r.id = ${onlyRecipeId}` : sql``;

  const rows = await db.execute<MatchRow>(sql`
    WITH src AS (
      SELECT n.name AS name, false AS basic FROM unnest(${sql.param(names)}::text[]) AS n(name)
      UNION ALL
      SELECT b.name, true FROM unnest(${sql.param(basicNames)}::text[]) AS b(name)
    ),
    src_norm AS (
      SELECT DISTINCT ${norm(sql`s.name`)} AS term, s.basic AS basic FROM src s
    ),
    canon AS (
      SELECT DISTINCT it.ingredient_id AS ingredient_id, s.basic AS basic
      FROM src_norm s
      JOIN ingredient_translation it
        ON ${norm(sql`it.nome`)} = s.term
        OR EXISTS (SELECT 1 FROM unnest(it.aliases) AS a(alias) WHERE ${norm(sql`a.alias`)} = s.term)
      WHERE s.term <> ''
    ),
    expanded AS (
      SELECT term, basic FROM src_norm
      UNION
      SELECT ${norm(sql`it.nome`)}, c.basic
      FROM canon c JOIN ingredient_translation it ON it.ingredient_id = c.ingredient_id
      UNION
      SELECT ${norm(sql`a.alias`)}, c.basic
      FROM canon c
      JOIN ingredient_translation it ON it.ingredient_id = c.ingredient_id
      CROSS JOIN LATERAL unnest(it.aliases) AS a(alias)
    ),
    terms AS (
      SELECT term, basic FROM expanded
      UNION
      SELECT ${SINGULAR_ES}, basic FROM expanded
      UNION
      SELECT ${SINGULAR_S}, basic FROM expanded
    ),
    patterns AS (
      SELECT
        '(^| )(' || string_agg(${ESC_TERM}, '|') FILTER (WHERE NOT basic) || ')(e?s)?( |$)' AS real_re,
        '^(' || string_agg(${ESC_TERM}, '|') FILTER (WHERE basic) || ')(e?s)?(( e | and | ou | or )('
          || string_agg(${ESC_TERM}, '|') FILTER (WHERE basic) || ')(e?s)?)*( a gosto| to taste| q b)?$' AS basic_re
      FROM terms
      WHERE term <> ''
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
        ${norm(sql`ri.raw_text`)} AS raw_n,
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
        AND ${viewerReadableSqlFragment("r", userId)}
        AND ${poolBarriersSqlFragment("r")}
        ${recipeFilter}
    ),
    hits AS (
      SELECT
        l.line_id,
        l.recipe_id,
        l.ordem,
        l.display_name,
        (
          l.ingredient_id = ANY (ci.real_ids)
          OR COALESCE(l.raw_n ~ p.real_re, false)
          OR COALESCE(l.tr_n ~ p.real_re, false)
        ) IS TRUE AS real_hit,
        (
          l.ingredient_id = ANY (ci.basic_ids)
          OR COALESCE(l.raw_n ~ p.basic_re, false)
          OR COALESCE(l.tr_n ~ p.basic_re, false)
        ) IS TRUE AS basic_hit
      FROM lines l CROSS JOIN patterns p CROSS JOIN canon_ids ci
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
    SELECT pr.recipe_id, pr.total, pr.covered, pr.missing_ids, pr.missing_names
    FROM per_recipe pr
    JOIN recipe r ON r.id = pr.recipe_id
    WHERE pr.real_covered >= 1
      AND pr.total - pr.covered <= ${maxMissing}
    ORDER BY pr.total - pr.covered ASC, pr.real_covered DESC, r.created_at DESC, pr.recipe_id
    LIMIT ${limit}
  `);
  return [...rows];
}

/** Os nomes da Despensa do Usuário (o que alimenta o casamento). */
async function loadPantryNames(
  db: Database,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ nome: pantryItem.nome })
    .from(pantryItem)
    .where(eq(pantryItem.userId, userId))
    .limit(MAX_PANTRY_ITEMS);
  return rows.map((r) => r.nome);
}

/**
 * "O que dá pra fazer" (dec.4): as Receitas legíveis ao viewer com no máximo `PANTRY_MAX_MISSING` Itens
 * faltando, ordenadas pelo que falta. O card é o MESMO de Salvos/Cardápio (`hydrateRecipeListItems`:
 * título por locale, slug, thumbnail sem imagem moderada). Despensa vazia ⇒ lista vazia.
 */
export async function loadPantryMatches(input: {
  db: Database;
  userId: string;
  basics: boolean;
  requestLocale: string;
  fallbackName: string;
}): Promise<PantryMatch[]> {
  const { db, userId, basics, requestLocale, fallbackName } = input;
  const names = await loadPantryNames(db, userId);
  const matches = await queryPantryMatches({
    db,
    userId,
    names,
    basics,
    locale: requestLocale,
    maxMissing: PANTRY_MAX_MISSING,
    limit: PANTRY_MATCH_LIMIT,
  });
  if (matches.length === 0) return [];

  const baseRows = await db
    .select({ ...RECIPE_LIST_COLS })
    .from(recipe)
    .leftJoin(
      recipeImage,
      and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)),
    )
    .where(
      inArray(
        recipe.id,
        matches.map((m) => m.recipe_id),
      ),
    );
  const cards = await hydrateRecipeListItems(
    db,
    baseRows,
    requestLocale,
    fallbackName,
  );
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const out: PantryMatch[] = [];
  for (const m of matches) {
    const card = cardById.get(m.recipe_id);
    if (!card) continue;
    out.push({
      id: card.id,
      name: card.name,
      ...(card.slug !== undefined ? { slug: card.slug } : {}),
      ...(card.imageUrl !== undefined ? { imageUrl: card.imageUrl } : {}),
      ...(card.imageAiGenerated ? { imageAiGenerated: true } : {}),
      total: m.total,
      covered: m.covered,
      missing: m.missing_names ?? [],
    });
  }
  return out;
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
  db: Database;
  userId: string;
  recipeId: string;
  basics: boolean;
  locale: string;
  listId?: string;
}): Promise<PantryMissingToListResult> {
  const { db, userId, recipeId, basics, locale } = input;
  const names = await loadPantryNames(db, userId);
  const [match] = await queryPantryMatches({
    db,
    userId,
    names,
    basics,
    locale,
    maxMissing: 1_000_000,
    limit: 1,
    onlyRecipeId: recipeId,
  });
  if (!match) return { kind: "not_found" };
  const missing = match.missing_ids ?? [];
  if (missing.length === 0) return { kind: "nothing_missing" };

  let list: { id: string; name: string };
  if (input.listId !== undefined) {
    const [own] = await db
      .select({ id: shoppingList.id, name: shoppingList.name })
      .from(shoppingList)
      .where(
        and(eq(shoppingList.id, input.listId), eq(shoppingList.userId, userId)),
      );
    if (!own) return { kind: "not_found" };
    list = own;
  } else {
    list = await ensureDefaultShoppingList({ db, userId });
  }

  const res = await applyAddRecipeLinesToShoppingList({
    db,
    userId,
    listId: list.id,
    recipeId,
    locale,
    lineIds: new Set(missing),
  });
  if (res.kind === "not_found") return res;
  return {
    kind: "ok",
    listId: list.id,
    listName: list.name,
    addedLines: res.addedLines,
  };
}

/**
 * "Guardar marcados na despensa" (dec.6): copia os NOMES dos itens marcados de uma Lista do próprio Usuário
 * para a Despensa. Não mexe na Lista. Nome longo demais para a Despensa (a Lista aceita até 200) é cortado
 * no teto da Despensa; idempotente pela chave; o teto da Despensa vale (tudo ou nada, como o adicionar).
 */
export async function applyCheckedItemsToPantry(input: {
  db: Database;
  userId: string;
  listId: string;
}): Promise<PantryFromCheckedResult> {
  const { db, userId, listId } = input;
  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)));
  if (!list) return { kind: "not_found" };

  const checked = await db
    .select({ nome: shoppingListItem.nome })
    .from(shoppingListItem)
    .where(
      and(
        eq(shoppingListItem.listId, listId),
        isNotNull(shoppingListItem.checkedAt),
      ),
    );
  const names = checked
    .map((c) => toPantryName(c.nome))
    .filter((n): n is string => n !== null);
  if (names.length === 0) return { kind: "nothing_checked" };

  const res = await applyAddPantryItems({ db, userId, names });
  if (res.kind === "limit_reached") return res;
  return { kind: "ok", added: res.added.length, existing: res.existing };
}

/** Nome de item da Lista → nome de item da Despensa (a Lista aceita até 200; corta no teto por code point). */
function toPantryName(nome: string): string | null {
  const parsed = parsePantryName(
    [...nome.trim()].slice(0, PANTRY_NAME_MAX).join(""),
  );
  return parsed === "invalid" ? null : parsed;
}

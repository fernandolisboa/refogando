import { describe, it, expect } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/server/deps";
import { pantryItem, shoppingList, shoppingListItem } from "@/db/schema";
import { MAX_PANTRY_ITEMS } from "@/domain/pantry";
import {
  GET as pantryGet,
  POST as pantryPost,
  DELETE as pantryClear,
} from "@/app/api/me/pantry/route";
import { DELETE as pantryItemDelete } from "@/app/api/me/pantry/[itemId]/route";
import { GET as matchesGet } from "@/app/api/me/pantry/matches/route";
import { POST as missingPost } from "@/app/api/me/pantry/missing-to-list/route";
import { POST as checkedToPantry } from "@/app/api/me/shopping-lists/[listId]/items/checked/to-pantry/route";
import { seedSessionHeaders } from "../helpers/users";
import {
  seedIngredient,
  seedIngredientTranslation,
  seedRecipe,
  seedRecipeIngredient,
  seedRemovedFromPool,
  seedTranslation,
} from "../helpers/recipes";

/**
 * ADR-0038 pela porta alta (route handlers): a Despensa. Inegociáveis: privada (404 leak-safe, nada de
 * outro usuário); o casamento é por palavra inteira + canônico, os básicos só cobrem a linha feita de
 * básicos e nunca bastam sozinhos; o resultado respeita o gate de Salvar; "pôr o que falta na lista"
 * recalcula no servidor e só adiciona o que falta.
 */

function req(
  url: string,
  method: string,
  headers?: Headers,
  body?: unknown,
): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

let seq = 0;
const session = () =>
  seedSessionHeaders({
    email: `pantry-${seq++}-${crypto.randomUUID()}@ex.com`,
  });

type Match = {
  id: string;
  name: string;
  total: number;
  covered: number;
  missing: string[];
};

async function addNames(
  headers: Headers,
  names: string | string[],
): Promise<Response> {
  return pantryPost(req("/api/me/pantry", "POST", headers, { names }));
}

async function matches(headers: Headers, qs = ""): Promise<Match[]> {
  const res = await matchesGet(
    req(`/api/me/pantry/matches${qs}`, "GET", headers),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { matches: Match[] }).matches;
}

/** Receita do catálogo aprovada com os Itens dados (nomes no pt-BR, locale de origem). */
async function catalogRecipe(titulo: string, items: string[]): Promise<string> {
  const recipeId = await seedRecipe({
    origin: "catalog",
    originalLocale: "pt-BR",
    ownerId: null,
    porcoes: 2,
  });
  await seedTranslation({
    recipeId,
    locale: "pt-BR",
    titulo,
    provenance: "escrita_por_pessoa",
  });
  let ordem = 0;
  for (const rawText of items) {
    await seedRecipeIngredient({
      recipeId,
      ordem: ordem++,
      rawText,
      quantidade: "100",
      unidade: "g" as never,
    });
  }
  return recipeId;
}

describe("Despensa — CRUD privado", () => {
  it("Visitante ⇒ 401 em todas as rotas", async () => {
    expect((await pantryGet(req("/api/me/pantry", "GET"))).status).toBe(401);
    expect(
      (await addNames(undefined as unknown as Headers, "ovo")).status,
    ).toBe(401);
    expect(
      (await matchesGet(req("/api/me/pantry/matches", "GET"))).status,
    ).toBe(401);
  });

  it("adiciona vários de uma vez, deduplica por chave e é idempotente", async () => {
    const { headers } = await session();
    const res = await addNames(
      headers,
      "Ovo, tomate;  ovo \n Pimenta-do-Reino",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      added: { nome: string }[];
      existing: number;
    };
    expect(body.added.map((a) => a.nome).sort()).toEqual([
      "Ovo",
      "Pimenta-do-Reino",
      "tomate",
    ]);

    const again = (await (
      await addNames(headers, ["OVO", "pimenta do reino", "queijo"])
    ).json()) as {
      added: { nome: string }[];
      existing: number;
    };
    expect(again.added.map((a) => a.nome)).toEqual(["queijo"]);
    expect(again.existing).toBe(2);

    const list = (await (
      await pantryGet(req("/api/me/pantry", "GET", headers))
    ).json()) as {
      items: { nome: string }[];
    };
    expect(list.items).toHaveLength(4);
  });

  it("rejeita entrada vazia, nome longo demais e lote grande", async () => {
    const { headers } = await session();
    expect((await addNames(headers, " , ;")).status).toBe(400);
    expect((await addNames(headers, "x".repeat(61))).status).toBe(400);
    expect(
      (
        await addNames(
          headers,
          Array.from({ length: 51 }, (_, i) => `item ${i}`),
        )
      ).status,
    ).toBe(400);
    expect(
      (await pantryPost(req("/api/me/pantry", "POST", headers, { names: 42 })))
        .status,
    ).toBe(400);
  });

  it("teto: passar do limite não grava nada (422)", async () => {
    const { headers, userId } = await session();
    await getDb()
      .insert(pantryItem)
      .values(
        Array.from({ length: MAX_PANTRY_ITEMS - 1 }, (_, i) => ({
          userId,
          nome: `item ${i}`,
          matchKey: `item ${i}`,
        })),
      );
    expect((await addNames(headers, "ovo, tomate")).status).toBe(422);
    expect((await addNames(headers, "ovo")).status).toBe(200);
    const rows = await getDb()
      .select()
      .from(pantryItem)
      .where(eq(pantryItem.userId, userId));
    expect(rows).toHaveLength(MAX_PANTRY_ITEMS);
  });

  it("remover e limpar só alcançam a própria Despensa (404 leak-safe)", async () => {
    const a = await session();
    const b = await session();
    const added = (await (await addNames(a.headers, "ovo, leite")).json()) as {
      added: { id: string }[];
    };
    const [first] = added.added;

    const foreign = await pantryItemDelete(
      req(`/api/me/pantry/${first.id}`, "DELETE", b.headers),
      {
        params: Promise.resolve({ itemId: first.id }),
      },
    );
    expect(foreign.status).toBe(404);
    await pantryClear(req("/api/me/pantry", "DELETE", b.headers));
    expect(
      await getDb()
        .select()
        .from(pantryItem)
        .where(eq(pantryItem.userId, a.userId)),
    ).toHaveLength(2);

    const own = await pantryItemDelete(
      req(`/api/me/pantry/${first.id}`, "DELETE", a.headers),
      {
        params: Promise.resolve({ itemId: first.id }),
      },
    );
    expect(own.status).toBe(200);
    const cleared = (await (
      await pantryClear(req("/api/me/pantry", "DELETE", a.headers))
    ).json()) as {
      removed: number;
    };
    expect(cleared.removed).toBe(1);
  });
});

describe("Despensa — o que dá pra fazer", () => {
  it("palavra inteira + plural; seções pelo que falta; básicos ligados por padrão", async () => {
    const { headers } = await session();
    const omelete = await catalogRecipe("Omelete da despensa", [
      "ovos",
      "sal",
      "queijo ralado",
    ]);
    const bolo = await catalogRecipe("Bolo da despensa", [
      "farinha de trigo",
      "ovo",
      "açúcar",
      "fermento",
      "leite",
    ]);
    const salsa = await catalogRecipe("Molho verde da despensa", [
      "salsinha",
      "água de coco",
    ]);
    await addNames(headers, "ovo, queijo, farinha, leite");

    const got = await matches(headers);
    const byId = new Map(got.map((m) => [m.id, m]));
    // Omelete: ovo cobre "ovos", queijo cobre "queijo ralado", sal é básico ⇒ nada faltando.
    expect(byId.get(omelete)).toMatchObject({
      total: 3,
      covered: 3,
      missing: [],
    });
    // Bolo: faltam açúcar e fermento.
    expect(byId.get(bolo)).toMatchObject({
      total: 5,
      covered: 3,
      missing: ["açúcar", "fermento"],
    });
    // "sal" não cobre "salsinha"; "água" (básico) não cobre "água de coco"; e só básico nunca basta.
    expect(byId.has(salsa)).toBe(false);
    // Ordem: menos faltando primeiro.
    expect(got.findIndex((m) => m.id === omelete)).toBeLessThan(
      got.findIndex((m) => m.id === bolo),
    );

    // Sem os básicos, o sal passa a faltar.
    const noBasics = new Map(
      (await matches(headers, "?basics=0")).map((m) => [m.id, m]),
    );
    expect(noBasics.get(omelete)).toMatchObject({
      covered: 2,
      missing: ["sal"],
    });
  });

  it("termo no plural cobre o Item no singular, e a linha feita só de básicos conta", async () => {
    const { headers } = await session();
    const r = await catalogRecipe("Tomate temperado da despensa", [
      "tomate",
      "sal e pimenta-do-reino",
      "azeite",
    ]);
    await addNames(headers, "tomates");
    const m = (await matches(headers)).find((x) => x.id === r);
    expect(m).toMatchObject({ total: 3, covered: 3, missing: [] });
  });

  it("com mais de 3 faltando a Receita não aparece", async () => {
    const { headers } = await session();
    const r = await catalogRecipe("Feijoada da despensa", [
      "feijão preto",
      "linguiça",
      "bacon",
      "costelinha",
      "paio",
    ]);
    await addNames(headers, "feijão preto");
    expect((await matches(headers)).some((m) => m.id === r)).toBe(false);
  });

  it('casa pelo canônico cross-locale: "ovo" cobre "eggs" numa Receita en-US', async () => {
    const { headers } = await session();
    const egg = await seedIngredient({ slug: `ovo-${crypto.randomUUID()}` });
    await seedIngredientTranslation({
      ingredientId: egg,
      locale: "pt-BR",
      nome: "ovo",
    });
    await seedIngredientTranslation({
      ingredientId: egg,
      locale: "en-US",
      nome: "egg",
    });
    const r = await seedRecipe({
      origin: "catalog",
      originalLocale: "en-US",
      ownerId: null,
    });
    await seedTranslation({
      recipeId: r,
      locale: "en-US",
      titulo: "Pantry fried eggs",
      provenance: "escrita_por_pessoa",
    });
    await seedRecipeIngredient({
      recipeId: r,
      ordem: 0,
      rawText: "large eggs",
    });
    await seedRecipeIngredient({ recipeId: r, ordem: 1, rawText: "butter" });
    await addNames(headers, "ovo");
    const m = (await matches(headers)).find((x) => x.id === r);
    expect(m).toMatchObject({ total: 2, covered: 1, missing: ["butter"] });
  });

  it("gate de Salvar: privada de outro, removida por moderação, lúdica e importada ficam de fora; a própria privada entra", async () => {
    const me = await session();
    const other = await session();
    const foreignPrivate = await seedRecipe({
      origin: "ai_chat",
      originalLocale: "pt-BR",
      ownerId: other.userId,
      visibility: "private",
    });
    await seedTranslation({
      recipeId: foreignPrivate,
      locale: "pt-BR",
      titulo: "Privada alheia",
      provenance: "escrita_por_pessoa",
    });
    await seedRecipeIngredient({
      recipeId: foreignPrivate,
      ordem: 0,
      rawText: "abobrinha",
    });
    const removed = await catalogRecipe("Removida da despensa", ["abobrinha"]);
    await seedRemovedFromPool({ recipeId: removed, curatorId: other.userId });
    const playful = await seedRecipe({
      origin: "ai_chat",
      originalLocale: "pt-BR",
      ownerId: me.userId,
      visibility: "private",
      resultKind: "playful",
    });
    await seedTranslation({
      recipeId: playful,
      locale: "pt-BR",
      titulo: "Zoeira",
      provenance: "escrita_por_pessoa",
    });
    await seedRecipeIngredient({
      recipeId: playful,
      ordem: 0,
      rawText: "abobrinha",
    });
    // A própria importada da web também fica de fora (barreira do pool, como Salvar).
    const imported = await seedRecipe({
      origin: "web_imported",
      originalLocale: "pt-BR",
      ownerId: me.userId,
      visibility: "private",
    });
    await seedTranslation({
      recipeId: imported,
      locale: "pt-BR",
      titulo: "Importada",
      provenance: "escrita_por_pessoa",
    });
    await seedRecipeIngredient({
      recipeId: imported,
      ordem: 0,
      rawText: "abobrinha",
    });
    const mine = await seedRecipe({
      origin: "ai_chat",
      originalLocale: "pt-BR",
      ownerId: me.userId,
      visibility: "private",
    });
    await seedTranslation({
      recipeId: mine,
      locale: "pt-BR",
      titulo: "Minha abobrinha",
      provenance: "escrita_por_pessoa",
    });
    await seedRecipeIngredient({
      recipeId: mine,
      ordem: 0,
      rawText: "abobrinha",
    });

    await addNames(me.headers, "abobrinha");
    const ids = (await matches(me.headers)).map((m) => m.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(foreignPrivate);
    expect(ids).not.toContain(removed);
    expect(ids).not.toContain(playful);
    expect(ids).not.toContain(imported);
  });

  it("Despensa vazia ⇒ nada; a Despensa de outro não vaza", async () => {
    const a = await session();
    const b = await session();
    await catalogRecipe("Arroz da despensa", ["arroz"]);
    await addNames(a.headers, "arroz");
    expect(await matches(b.headers)).toEqual([]);
  });
});

describe("Despensa — pontes", () => {
  it('"pôr o que falta na lista" recalcula no servidor e só adiciona o que falta', async () => {
    const { headers, userId } = await session();
    const bolo = await catalogRecipe("Bolo simples da despensa", [
      "farinha de trigo",
      "ovo",
      "açúcar",
    ]);
    await addNames(headers, "ovo, farinha");

    const res = await missingPost(
      req("/api/me/pantry/missing-to-list?locale=pt-BR", "POST", headers, {
        recipeId: bolo,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      listId: string;
      listName: string;
      addedLines: number;
    };
    expect(body.addedLines).toBe(1);
    const items = await getDb()
      .select()
      .from(shoppingListItem)
      .where(eq(shoppingListItem.listId, body.listId));
    expect(items.map((i) => i.nome)).toEqual(["açúcar"]);
    const [list] = await getDb()
      .select()
      .from(shoppingList)
      .where(eq(shoppingList.id, body.listId));
    expect(list.userId).toBe(userId);

    // Tendo tudo, nada a pôr.
    await addNames(headers, "açúcar");
    const none = await missingPost(
      req("/api/me/pantry/missing-to-list", "POST", headers, {
        recipeId: bolo,
      }),
    );
    expect(none.status).toBe(409);
  });

  it('"pôr o que falta": lista de outro, Receita ilegível e id inválido ⇒ 404', async () => {
    const a = await session();
    const b = await session();
    const r = await catalogRecipe("Pão da despensa", [
      "farinha de trigo",
      "fermento",
    ]);
    await addNames(a.headers, "farinha");
    const [bList] = await getDb()
      .insert(shoppingList)
      .values({ userId: b.userId, name: "Da B" })
      .returning();
    expect(
      (
        await missingPost(
          req("/api/me/pantry/missing-to-list", "POST", a.headers, {
            recipeId: r,
            listId: bList.id,
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await missingPost(
          req("/api/me/pantry/missing-to-list", "POST", a.headers, {
            recipeId: "nope",
          }),
        )
      ).status,
    ).toBe(404);
    const other = await seedRecipe({
      origin: "ai_chat",
      originalLocale: "pt-BR",
      ownerId: b.userId,
      visibility: "private",
    });
    await seedRecipeIngredient({
      recipeId: other,
      ordem: 0,
      rawText: "farinha",
    });
    await seedRecipeIngredient({
      recipeId: other,
      ordem: 1,
      rawText: "sal grosso",
    });
    expect(
      (
        await missingPost(
          req("/api/me/pantry/missing-to-list", "POST", a.headers, {
            recipeId: other,
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      await getDb()
        .select()
        .from(shoppingListItem)
        .where(eq(shoppingListItem.listId, bList.id)),
    ).toHaveLength(0);
  });

  it('"guardar marcados na despensa" copia só os marcados da própria Lista', async () => {
    const a = await session();
    const b = await session();
    const [list] = await getDb()
      .insert(shoppingList)
      .values({ userId: a.userId, name: "Feira" })
      .returning();
    await getDb()
      .insert(shoppingListItem)
      .values([
        {
          listId: list.id,
          nome: "Tomate",
          matchKey: "tomate",
          checkedAt: new Date(),
        },
        { listId: list.id, nome: "Cebola", matchKey: "cebola" },
        {
          listId: list.id,
          nome: "x".repeat(120),
          matchKey: "x".repeat(120),
          checkedAt: new Date(),
        },
      ]);
    const call = (h: Headers) =>
      checkedToPantry(
        req(
          `/api/me/shopping-lists/${list.id}/items/checked/to-pantry`,
          "POST",
          h,
        ),
        {
          params: Promise.resolve({ listId: list.id }),
        },
      );

    expect((await call(b.headers)).status).toBe(404);
    const res = await call(a.headers);
    expect(res.status).toBe(200);
    const names = (
      await getDb()
        .select()
        .from(pantryItem)
        .where(eq(pantryItem.userId, a.userId))
    ).map((p) => p.nome);
    expect(names.sort()).toEqual(["Tomate", "x".repeat(60)]);
    // A Lista fica como estava.
    expect(
      await getDb()
        .select()
        .from(shoppingListItem)
        .where(
          and(
            eq(shoppingListItem.listId, list.id),
            isNotNull(shoppingListItem.checkedAt),
          ),
        ),
    ).toHaveLength(2);
    // Idempotente.
    const again = (await (await call(a.headers)).json()) as {
      added: number;
      existing: number;
    };
    expect(again).toMatchObject({ added: 0, existing: 2 });
  });
});

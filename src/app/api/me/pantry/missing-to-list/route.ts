import { requireSession } from "@/server/auth/guard";
import { getDb } from "@/server/deps";
import {
  isUuid,
  parseRequestLocale,
  readJsonObject,
} from "@/server/http/params";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/i18n/locale";
import { applyPantryMissingToShoppingList } from "@/server/pantry/pantry";

/**
 * "Pôr o que falta na lista" (ADR-0038 dec.5a). O SERVIDOR recalcula o que falta da Receita contra a
 * Despensa atual — o cliente só diz qual Receita (e se "Tenho o básico" está ligado) — e adiciona esses
 * Itens, na quantidade base, à Lista indicada ou à lista-padrão (criada no 1º uso).
 *
 * POST {recipeId, basics?: boolean, listId?}[?locale] → 200 `{ ok: true, listId, listName, addedLines }` |
 * 404 not_found (Receita ilegível/sem casamento, Lista de outro, uuid inválido) | 409 nada_faltando.
 */

export const runtime = "nodejs"; // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request);
  if (!g.ok) return g.response;

  const body = await readJsonObject(request);
  if (typeof body.recipeId !== "string" || !isUuid(body.recipeId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (
    body.listId !== undefined &&
    (typeof body.listId !== "string" || !isUuid(body.listId))
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (body.basics !== undefined && typeof body.basics !== "boolean") {
    return Response.json({ error: "dados_invalidos" }, { status: 400 });
  }

  const requestLocale = parseRequestLocale(request);
  const locale = isSupportedLocale(requestLocale)
    ? requestLocale
    : DEFAULT_LOCALE;

  const res = await applyPantryMissingToShoppingList({
    db: getDb(),
    userId: g.session.user.id,
    recipeId: body.recipeId,
    basics: body.basics !== false,
    locale,
    ...(typeof body.listId === "string" ? { listId: body.listId } : {}),
  });
  switch (res.kind) {
    case "ok":
      return Response.json(
        {
          ok: true,
          listId: res.listId,
          listName: res.listName,
          addedLines: res.addedLines,
        },
        { status: 200 },
      );
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "nothing_missing":
      return Response.json({ error: "nada_faltando" }, { status: 409 });
  }
}

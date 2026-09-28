import { requireSession } from "@/server/auth/guard";
import { getDb } from "@/server/deps";
import { isUuid } from "@/server/http/params";
import { applyCheckedItemsToPantry } from "@/server/pantry/pantry";

/**
 * "Guardar marcados na despensa" (ADR-0038 dec.6): copia os nomes dos Itens marcados da Lista do próprio
 * usuário para a Despensa. Não apaga nada da Lista ("remover marcados" segue sendo a ação explícita).
 *
 * POST → 200 `{ ok: true, added, existing }` | 404 not_found (lista de outro/uuid inválido) | 409
 * nada_marcado | 422 despensa_cheia (passaria do teto; nada é gravado).
 */

export const runtime = "nodejs"; // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params;
  if (!isUuid(listId))
    return Response.json({ error: "not_found" }, { status: 404 });

  const g = await requireSession(request);
  if (!g.ok) return g.response;

  const res = await applyCheckedItemsToPantry({
    db: getDb(),
    userId: g.session.user.id,
    listId,
  });
  switch (res.kind) {
    case "ok":
      return Response.json(
        { ok: true, added: res.added, existing: res.existing },
        { status: 200 },
      );
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "nothing_checked":
      return Response.json({ error: "nada_marcado" }, { status: 409 });
    case "limit_reached":
      return Response.json({ error: "despensa_cheia" }, { status: 422 });
  }
}

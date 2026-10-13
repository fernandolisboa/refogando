import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { readJsonObject } from '@/server/http/params'
import { parsePantryRestore } from '@/domain/pantry'
import { applyAddPantryItems } from '@/server/pantry/pantry'

/**
 * "Desfazer" do "Cozinhei" (ADR-0042 dec.2): devolve à Despensa os nomes que o servidor acabou de tirar.
 * É o mesmo "adicionar" (idempotente pela chave, teto tudo-ou-nada), com UMA diferença: cada elemento é UM
 * nome, sem split por vírgula — um item que veio da Lista de compras pode ter vírgula, e o desfazer devolve
 * exatamente o que saiu. Não dá à pessoa nada que o "adicionar" já não dê: são nomes da própria Despensa.
 *
 * POST {names: string[]} → 200 `{ ok: true, added, existing }` | 400 dados_invalidos | 422 despensa_cheia.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = await readJsonObject(request)
  const names = parsePantryRestore(body.names)
  if (names === 'invalid') return Response.json({ error: 'dados_invalidos' }, { status: 400 })

  const res = await applyAddPantryItems({ db: getDb(), userId: g.session.user.id, names })
  if (res.kind === 'limit_reached') return Response.json({ error: 'despensa_cheia' }, { status: 422 })
  return Response.json({ ok: true, added: res.added, existing: res.existing }, { status: 200 })
}

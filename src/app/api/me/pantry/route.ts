import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { readJsonObject } from '@/server/http/params'
import { splitPantryInput } from '@/domain/pantry'
import { applyAddPantryItems, applyClearPantry, loadPantry } from '@/server/pantry/pantry'

/**
 * Despensa do PRÓPRIO usuário (ADR-0038). `requireSession` ANTES do DB (Visitante ⇒ 401, zero efeito),
 * resposta pessoal `no-store`, escopo HARD-WIRED em `session.user.id`.
 *
 * GET → `{ items: PantryItemView[] }`.
 * POST {names: string | string[]} → 200 `{ ok: true, added, existing }` (vários de uma vez, separados por
 *   vírgula; o que já está na Despensa conta em `existing`, idempotente) | 400 dados_invalidos (vazio, nome
 *   longo demais, mais de 50 de uma vez) | 422 despensa_cheia (passaria do teto; nada é gravado).
 * DELETE → 200 `{ ok: true, removed }` ("Limpar despensa").
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const items = await loadPantry({ db: getDb(), userId: g.session.user.id })
  return Response.json({ items }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = await readJsonObject(request)
  const names = splitPantryInput(body.names)
  if (names === 'invalid' || names === 'too_many') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  const res = await applyAddPantryItems({
    db: getDb(),
    userId: g.session.user.id,
    names,
  })
  if (res.kind === 'limit_reached') return Response.json({ error: 'despensa_cheia' }, { status: 422 })
  return Response.json({ ok: true, added: res.added, existing: res.existing }, { status: 200 })
}

export async function DELETE(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const res = await applyClearPantry({
    db: getDb(),
    userId: g.session.user.id,
  })
  return Response.json({ ok: true, removed: res.removed }, { status: 200 })
}

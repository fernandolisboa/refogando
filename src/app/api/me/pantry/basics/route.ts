import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { readJsonObject } from '@/server/http/params'
import { parsePantryBasics } from '@/domain/pantry'
import { applySetPantryBasics } from '@/server/pantry/pantry'

/**
 * Os BÁSICOS da Despensa da própria pessoa (ADR-0042 dec.4): o que "Tenho o básico" conta como em casa e o
 * que o "Cozinhei" nunca tira. A leitura vem junto da Despensa (`GET /api/me/pantry`).
 *
 * PUT {basics: string[]} → 200 `{ ok: true, basics, custom: true }` (a lista inteira, um nome por elemento;
 *   vazia vale — "não tenho básico nenhum") | 400 dados_invalidos (não-array, nome inválido, mais de 30).
 * DELETE → 200 `{ ok: true, basics, custom: false }` (volta à lista padrão).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function PUT(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = await readJsonObject(request)
  const basics = parsePantryBasics(body.basics)
  if (basics === 'invalid' || basics === 'too_many') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  const res = await applySetPantryBasics({ db: getDb(), userId: g.session.user.id, basics })
  return Response.json({ ok: true, basics: res.basics, custom: res.custom }, { status: 200 })
}

export async function DELETE(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const res = await applySetPantryBasics({ db: getDb(), userId: g.session.user.id, basics: null })
  return Response.json({ ok: true, basics: res.basics, custom: res.custom }, { status: 200 })
}

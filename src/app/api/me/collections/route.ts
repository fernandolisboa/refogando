import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { applyCollectionCreate, loadCollections } from '@/server/recipe/collections'

/**
 * Coleções do PRÓPRIO usuário (#364) — pastas PRIVADAS sobre o Salvar (#362). Route FINO
 * espelhando `me/recipes` + `social`: `requireSession` ANTES do DB (Visitante ⇒ 401, zero efeito);
 * GET per-viewer com `cache-control: no-store` (resposta pessoal, nunca cacheável compartilhada).
 * LEAK-SAFE por construção: os loaders escopam por `session.user.id` (HARD-WIRED, nunca de query).
 *
 * GET → `{ collections: CollectionSummary[] }` (id, name, createdAt, itemCount), ordenadas por nome.
 * POST {name} → 200 `{ collection }` | 400 nome_invalido | 409 nome_duplicado | 422 limite_colecoes.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const collections = await loadCollections({ db: getDb(), userId: g.session.user.id })
  return Response.json({ collections }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof body.name !== 'string') {
    return Response.json({ error: 'nome_invalido' }, { status: 400 })
  }

  const res = await applyCollectionCreate({
    db: getDb(),
    userId: g.session.user.id,
    name: body.name,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ collection: res.collection }, { status: 200 })
    case 'invalid_name':
      return Response.json({ error: 'nome_invalido' }, { status: 400 })
    case 'duplicate_name':
      return Response.json({ error: 'nome_duplicado' }, { status: 409 })
    case 'limit_reached':
      return Response.json({ error: 'limite_colecoes' }, { status: 422 })
  }
}

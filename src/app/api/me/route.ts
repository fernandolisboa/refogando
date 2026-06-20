import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'

/**
 * Contrato `/api/me` — perfil do logado (#124, frente Perfil). Primeira fatia: nome + bio.
 * As fatias seguintes (#126/#127/#128/#129: avatar/links/handle/perfil público) ESTENDEM
 * este shape; por isso o GET devolve um objeto de perfil, não só os campos editáveis.
 *
 * Owner-only via `requireSession` (ADR-0011, mesma tese de /api/me/locale): 401 = Visitante
 * (sem sessão) OU conta soft-deletada (deletedAt != null). Toca SÓ `users` — nunca `recipe`.
 *
 * GET devolve { id, name, email, bio }. `email` é READ-ONLY (identidade, gerida pelo Better
 * Auth) — o PATCH nunca o muda, mesmo se vier no corpo. PATCH valida e grava name + bio:
 *  - name: trimado; não pode ficar vazio (400 nome_invalido);
 *  - bio: string opcional, cap de BIO_MAX_LEN chars (400 bio_invalida); vazia/só-espaços → null.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/** Cap de tamanho da bio (≈280, history-tweet-ish). Enforced no app, não no banco. */
const BIO_MAX_LEN = 280

type Profile = { id: string; name: string; email: string; bio: string | null }

function profileJson(p: Profile): Response {
  return Response.json(p)
}

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const [row] = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, bio: users.bio })
    .from(users)
    .where(eq(users.id, g.session.user.id))
  // A sessão é válida (requireSession passou), então a linha existe; o `?? null` é só defensivo.
  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return profileJson(row)
}

export async function PATCH(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { name?: unknown; bio?: unknown }

  // name: obrigatório, trimado, não-vazio.
  if (typeof body.name !== 'string') {
    return Response.json({ error: 'nome_invalido' }, { status: 400 })
  }
  const name = body.name.trim()
  if (name.length === 0) {
    return Response.json({ error: 'nome_invalido' }, { status: 400 })
  }

  // bio: opcional. Se presente, precisa ser string e respeitar o cap. Vazia/só-espaços → null.
  // Trima ANTES de medir (mesma tese do name): o que conta para o cap é o conteúdo gravado,
  // não o whitespace de borda — senão um corpo no limite + um "\n" final daria 400 espúrio.
  let bio: string | null = null
  if (body.bio !== undefined && body.bio !== null) {
    if (typeof body.bio !== 'string') {
      return Response.json({ error: 'bio_invalida' }, { status: 400 })
    }
    const trimmed = body.bio.trim()
    if (trimmed.length > BIO_MAX_LEN) {
      return Response.json({ error: 'bio_invalida' }, { status: 400 })
    }
    bio = trimmed.length === 0 ? null : trimmed
  }

  // email é READ-ONLY: não entra no SET. Toca SÓ `users`.
  const [row] = await getDb()
    .update(users)
    .set({ name, bio, updatedAt: new Date() })
    .where(eq(users.id, g.session.user.id))
    .returning({ id: users.id, name: users.name, email: users.email, bio: users.bio })

  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return profileJson(row)
}

import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { validateHandle } from '@/domain/handle'
import { validateLinks, type ProfileLink } from '@/domain/links'
import { isHandleAvailable } from '@/server/handle'

/**
 * Contrato `/api/me` — perfil do logado (#124, frente Perfil). name + bio + handle (#128) +
 * links (#127). As fatias seguintes (#126/#129: avatar/perfil público) ESTENDEM este shape;
 * por isso o GET devolve um objeto de perfil, não só os campos editáveis.
 *
 * Owner-only via `requireSession` (ADR-0011, mesma tese de /api/me/locale): 401 = Visitante
 * (sem sessão) OU conta soft-deletada (deletedAt != null). Toca SÓ `users` — nunca `recipe`.
 *
 * GET devolve { id, name, email, bio, handle, links }. `email` é READ-ONLY (identidade, gerida
 * pelo Better Auth) — o PATCH nunca o muda, mesmo se vier no corpo. PATCH valida e grava:
 *  - name: trimado; não pode ficar vazio (400 nome_invalido);
 *  - bio: string opcional, cap de BIO_MAX_LEN chars (400 bio_invalida); vazia/só-espaços → null;
 *  - handle (#128): opcional. Se presente, minúsculo/trimado; valida FORMATO (400 handle_invalid),
 *    RESERVADAS (400 handle_reserved) e UNICIDADE (409 handle_taken). Ausente → inalterado.
 *  - links (#127): opcional. Se presente, valida via `validateLinks` (≤5, tipo conhecido, só URL
 *    http(s) segura — recusa `javascript:`/`data:` etc. com 400 links_invalid). Ausente → inalterado.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/** Cap de tamanho da bio (≈280, history-tweet-ish). Enforced no app, não no banco. */
const BIO_MAX_LEN = 280

type Profile = {
  id: string
  name: string
  email: string
  bio: string | null
  handle: string
  links: ProfileLink[]
}

function profileJson(p: Profile): Response {
  return Response.json(p)
}

const profileCols = {
  id: users.id,
  name: users.name,
  email: users.email,
  bio: users.bio,
  handle: users.handle,
  links: users.links,
} as const

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const [row] = await getDb().select(profileCols).from(users).where(eq(users.id, g.session.user.id))
  // A sessão é válida (requireSession passou), então a linha existe; o `?? null` é só defensivo.
  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return profileJson(row)
}

export async function PATCH(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown
    bio?: unknown
    handle?: unknown
    links?: unknown
  }

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

  // handle (#128): OPCIONAL. Ausente/undefined → inalterado (saves de só name/bio seguem
  // funcionando). Se presente, normaliza (trim + lower — o usuário pode digitar maiúsculas) e
  // valida FORMATO (400 handle_invalid), RESERVADAS (400 handle_reserved) e UNICIDADE
  // (409 handle_taken, excluindo o próprio dono — manter o handle atual não é colisão).
  let handle: string | undefined
  if (body.handle !== undefined && body.handle !== null) {
    if (typeof body.handle !== 'string') {
      return Response.json({ error: 'handle_invalid' }, { status: 400 })
    }
    const candidate = body.handle.trim().toLowerCase()
    const v = validateHandle(candidate)
    if (!v.ok) {
      // reserved e invalid são ambos 400 (erro de entrada do cliente), só muda a chave.
      const error = v.reason === 'reserved' ? 'handle_reserved' : 'handle_invalid'
      return Response.json({ error }, { status: 400 })
    }
    if (!(await isHandleAvailable(candidate, g.session.user.id))) {
      return Response.json({ error: 'handle_taken' }, { status: 409 })
    }
    handle = candidate
  }

  // links (#127): OPCIONAL. Ausente/undefined → inalterado (saves de só name/bio/handle seguem
  // funcionando). Se presente, `validateLinks` (kernel puro) checa contagem (≤5), tipo conhecido
  // e — CRÍTICO — só URL http(s) SEGURA: qualquer esquema perigoso (`javascript:`/`data:`/
  // protocol-relative `//`) é recusado, porque #129 renderiza esses links CLICÁVEIS no perfil
  // público (esquema inseguro = XSS armazenado / phishing). Qualquer recusa → 400 links_invalid.
  // Grava a lista NORMALIZADA (URLs trimadas), não o corpo cru.
  let links: ProfileLink[] | undefined
  if (body.links !== undefined && body.links !== null) {
    const v = validateLinks(body.links)
    if (!v.ok) {
      return Response.json({ error: 'links_invalid' }, { status: 400 })
    }
    links = v.links
  }

  // email é READ-ONLY: não entra no SET. handle/links só entram se foram fornecidos e validados.
  // Toca SÓ `users`. A UNIQUE `users_handle_uq` é a rede final contra corrida (23505 → 409 abaixo).
  try {
    const [row] = await getDb()
      .update(users)
      .set({
        name,
        bio,
        ...(handle !== undefined ? { handle } : {}),
        ...(links !== undefined ? { links } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, g.session.user.id))
      .returning(profileCols)

    if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
    return profileJson(row)
  } catch (err) {
    // Corrida: outro signup/troca pegou o handle entre o check e o UPDATE → a UNIQUE estoura
    // (Postgres 23505). Traduz pra 409 handle_taken (mesma resposta do check pré-UPDATE).
    if (isUniqueViolation(err)) {
      return Response.json({ error: 'handle_taken' }, { status: 409 })
    }
    throw err
  }
}

/** Detecta violação de UNIQUE do Postgres (SQLSTATE 23505), agnóstica ao driver. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}

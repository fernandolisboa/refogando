import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { parseRequestLocale } from '@/server/http/params'
import { listPublicRecipesByOwner } from '@/server/recipe/list-public'
import { buildPublicProfile } from '@/domain/recipe-profile-read'
import { validateLinks } from '@/domain/links'

/**
 * Perfil PÚBLICO (#129): GET `/api/u/<handle>?locale=`. ANÔNIMO-readable (ADR-0011) — sem
 * sessão, sem 401: um Visitante vê nome/avatar/bio/links + as Receitas PÚBLICAS daquela pessoa.
 * Route FINO (espelha `api/recipes/[id]`): resolve o dono pelo handle, carrega o pool dele e
 * delega a montagem ao módulo PURO `buildPublicProfile`.
 *
 * 404 leak-safe: handle inexistente (ou conta soft-deletada — `deleted_at IS NULL` no gate)
 * devolve `not_found` — não vaza existência nem o privado de ninguém. O handle é normalizado
 * (lower) antes da consulta, espelhando a gravação no PATCH /api/me (#128).
 *
 * SEGURANÇA dos links: os links já foram validados http(s)-only na escrita (#127), mas
 * `validateLinks` é RE-aplicado aqui como defesa-em-profundidade (a UI os renderiza CLICÁVEIS)
 * — qualquer entrada que escape a validação histórica é saneada antes de sair no DTO.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle: rawHandle } = await params
  // Normaliza como na gravação (#128): trim + lower. Handle vazio → 404 (sem tocar o DB útil).
  const handle = rawHandle.trim().toLowerCase()
  if (handle.length === 0) return notFound()

  const requestLocale = parseRequestLocale(request)
  const db = getDb()

  // Resolve o dono pelo handle. `deleted_at IS NULL` exclui contas soft-deletadas (não vaza
  // perfil de conta desativada). Só os campos PÚBLICOS — nunca email/role/id-na-resposta.
  const [owner] = await db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
      bio: users.bio,
      links: users.links,
    })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1)
  if (!owner) return notFound()

  // Receitas PÚBLICAS (pool) do dono — privadas/playful/removidas NUNCA entram (list-public.ts).
  const recipeRows = await listPublicRecipesByOwner(db, owner.id)

  // Defesa-em-profundidade (#127/#129): re-valida os links http(s)-only antes de emitir. Lista
  // inválida (não deveria ocorrer — a escrita já valida) ⇒ cai p/ vazia, nunca emite link inseguro.
  const linksCheck = validateLinks(owner.links)
  const links = linksCheck.ok ? linksCheck.links : []

  const profile = buildPublicProfile({
    name: owner.name,
    handle: owner.handle,
    image: owner.image,
    bio: owner.bio,
    links,
    recipeRows,
    requestLocale,
  })

  return Response.json(profile)
}

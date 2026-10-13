import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { loadPublicProfile } from '@/server/user/public-profile'

/**
 * Perfil PÚBLICO (#129): GET `/api/u/<handle>?locale=`. ANÔNIMO-readable (ADR-0011) — sem
 * sessão, sem 401: um Visitante vê nome/avatar/bio/links + as Receitas PÚBLICAS daquela pessoa.
 * Route FINO (espelha `api/recipes/[id]`): delega TUDO a `loadPublicProfile` (loader de servidor
 * compartilhado com a página `/{locale}/u/[handle]`, que o chama direto — sem self-fetch).
 *
 * 404 leak-safe: handle inexistente (ou conta soft-deletada — `deleted_at IS NULL` no gate)
 * devolve `not_found` — não vaza existência nem o privado de ninguém. O handle é normalizado
 * (lower) antes da consulta, espelhando a gravação no PATCH /api/me (#128).
 *
 * SEGURANÇA dos links: os links já foram validados http(s)-only na escrita (#127), mas
 * `validateLinks` é RE-aplicado no loader como defesa-em-profundidade (a UI os renderiza
 * CLICÁVEIS) — qualquer entrada que escape a validação histórica é saneada antes de sair no DTO.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle: rawHandle } = await params
  const profile = await loadPublicProfile(getDb(), rawHandle, parseRequestLocale(request))
  if (profile === null) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(profile)
}

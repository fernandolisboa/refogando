import { getDb } from '@/server/deps'
import { stripControlChars } from '@/domain/search-terms'
import { MAX_USER_QUERY_LEN, projectPublicCook } from '@/domain/user-search-read'
import { searchCooks } from '@/server/user/search'

/**
 * Busca PÚBLICA de Cozinheiros (#279, ADR-0024) — o cluster da Busca mesclada. GET `?q=` → `{ cooks }`,
 * os Cozinheiros que casam o termo por nome/@handle (força-de-match: exato>prefixo>substring), reusando
 * o seam `searchUsers` (#269) com `includeEmail=false`. Endpoint SEPARADO (espelha `/api/discovery/web`):
 * a UI dispara em paralelo com `/api/search`, que fica BYTE-IDÊNTICO (a lista de Receitas não muda).
 *
 * SEM SESSÃO (cookie-free): a busca de Cozinheiros é VIEWER-INDEPENDENTE (mesmos resultados pra todos) —
 * não lê o cookie, nunca 401, naturalmente cacheável. "Buscar pessoas NUNCA cria nada" (GET puro).
 *
 * Sanitização espelha `/api/search` e `/api/discovery/web`: `stripControlChars` (um NUL/C0 num param de
 * texto estoura o postgres-js → 500) + `trim` + corte em `MAX_USER_QUERY_LEN`. O resto dos gates (barrar
 * `id`/`email`, termo < 2 chars, limite server-controlled) vive no seam `searchCooks`. A rota projeta a
 * linha crua → `ProfileFollowUser` (allowlist: sem id/role/email) — NUNCA devolve a linha do loader.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = stripControlChars(url.searchParams.get('q') ?? '')
    .trim()
    .slice(0, MAX_USER_QUERY_LEN)

  // ASSISTIVO (espelha /api/discovery/web, NÃO /api/search): qualquer falha de DB degrada a `{cooks:[]}`
  // (200), nunca 500. O cluster é um extra da Busca — uma query de Cozinheiro lenta/falha NÃO pode
  // derrubar a superfície (as receitas seguem). O cliente também limpa o cluster num fetch não-ok.
  try {
    const rows = await searchCooks(getDb(), q)
    return Response.json({ cooks: rows.map(projectPublicCook) })
  } catch {
    return Response.json({ cooks: [] })
  }
}

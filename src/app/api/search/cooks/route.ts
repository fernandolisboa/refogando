import { getDb } from '@/server/deps'
import { stripControlChars, parseCozinhasParam } from '@/domain/search-terms'
import { MAX_USER_QUERY_LEN } from '@/domain/user-search-read'
import { decodeSearchCursor } from '@/domain/cooks-cursor'
import { searchCooks } from '@/server/user/search'

/**
 * Busca PÚBLICA de Cozinheiros (#279 cluster da Busca mesclada + #308 Descoberta dedicada). GET
 * `?q=&cozinha=&cursor=` → `{ cooks, nextCursor }`: os Cozinheiros que casam o termo por nome/@handle
 * (força-de-match: exato>prefixo>substring), opcionalmente filtrados por Cozinha, paginados por keyset.
 * Endpoint SEPARADO (espelha `/api/discovery/web`): a UI dispara em paralelo com `/api/search`, que fica
 * BYTE-IDÊNTICO. Sem `?cozinha=`/`?cursor=`, o cluster #279 segue idêntico (top-N sem paginar/filtrar).
 *
 * SEM SESSÃO (cookie-free): a busca de Cozinheiros é VIEWER-INDEPENDENTE (mesmos resultados pra todos) —
 * não lê o cookie, nunca 401, naturalmente cacheável. "Buscar pessoas NUNCA cria nada" (GET puro).
 *
 * Sanitização espelha `/api/search`/`/api/discovery/web`: `stripControlChars` no `q` e em cada cozinha
 * (um NUL/C0 num text param estoura o postgres-js → 500) + trim + cortes. O cursor forjado vira `null`
 * (primeira página, nunca 500). O resto dos gates (barrar `id`/`email`, termo < min, limite server-
 * controlled, allowlist `name/handle/image`) vive no seam `searchCooks` — a rota NUNCA expõe id/role/email.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = stripControlChars(url.searchParams.get('q') ?? '')
    .trim()
    .slice(0, MAX_USER_QUERY_LEN)
  const cozinhas = parseCozinhasParam(url.searchParams.get('cozinha'))
  const cursor = decodeSearchCursor(url.searchParams.get('cursor'))

  // ASSISTIVO (espelha /api/discovery/web, NÃO /api/search): qualquer falha de DB degrada a
  // `{cooks:[], nextCursor:null}` (200), nunca 500. O cluster/página são extras da Busca — uma query de
  // Cozinheiro lenta/falha NÃO pode derrubar a superfície. O cliente também limpa num fetch não-ok.
  try {
    const { cooks, nextCursor } = await searchCooks(getDb(), { q, cozinhas, cursor })
    return Response.json({ cooks, nextCursor })
  } catch {
    return Response.json({ cooks: [], nextCursor: null })
  }
}

import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

/**
 * Catch-all do Better Auth (issue #5, ADR-0010): sign-up/in/out, sessão, OAuth, e os
 * endpoints do plugin admin. Route handlers, NÃO Server Actions (D2 — sem nextCookies).
 * Node runtime (a lib não roda em edge): NÃO declarar `export const runtime = 'edge'`.
 *
 * CRÍTICO (E1): NÃO montar `toNextJsHandler(getAuth())` no top-level do módulo — isso
 * resolveria `getDb()` na coleta/`next build`, antes de o ambiente estar pronto. A
 * instância é DEFERIDA para dentro de cada request: `getAuth()` (memoizada) só nasce
 * quando o handler roda, já com o DB resolvido.
 *
 * QM-3: memoiza o resultado de `toNextJsHandler` (lazy) para não reconstruí-lo a cada
 * request. `handlers()` resolve `getAuth()` só na 1ª chamada (deferimento preservado).
 */
let _handlers: ReturnType<typeof toNextJsHandler> | null = null
let _handlersAuth: ReturnType<typeof getAuth> | null = null
// Reconstruído só se a instância mudar (`resetAuthForTests`, #470); em produção a instância é uma só.
function handlers(): ReturnType<typeof toNextJsHandler> {
  const auth = getAuth()
  if (!_handlers || _handlersAuth !== auth) {
    _handlers = toNextJsHandler(auth)
    _handlersAuth = auth
  }
  return _handlers
}

export async function GET(req: Request): Promise<Response> {
  return handlers().GET(req)
}

export async function POST(req: Request): Promise<Response> {
  return handlers().POST(req)
}

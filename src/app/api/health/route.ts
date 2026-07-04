import { getClaudeClient, getDb } from '@/server/deps'
import { ping } from '@/db/schema'

/**
 * Route handler trivial de saúde — a "porta mais alta" exercitada pelos testes de
 * integração da fundação. Síncrono de propósito: o streaming token-a-token da
 * geração é da issue #8 (ADR-0010); o seam `echo()` é não-streaming.
 */

// #445: teto do corpo do POST — o `message` vira uma linha em `ping`, então limitamos o texto
// persistido (defesa contra enchimento de storage). O `.slice` é barato e nunca lança.
const HEALTH_MESSAGE_MAX = 1024

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'refogando', status: 'up' })
}

export async function POST(request: Request): Promise<Response> {
  // #445: o POST é resquício da fundação (issue #2) usado só pelos testes de integração — em
  // PRODUÇÃO ele seria uma escrita ANÔNIMA e ilimitada no banco (sem sessão, sem rate-limit). O
  // GET basta como liveness em prod; fechamos o POST fora de teste. NODE_ENV==='production' cobre
  // deploy de produção E previews da Vercel; o harness de integração roda em 'test' e segue passando.
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as { message?: unknown }
  const raw = typeof body.message === 'string' ? body.message : ''
  const message = raw.slice(0, HEALTH_MESSAGE_MAX)

  // Passa pelo seam do Claude (trocável por dublê nos testes) e toca o Postgres real.
  const echoed = await getClaudeClient().echo(message)
  const [row] = await getDb().insert(ping).values({ message: echoed }).returning()

  return Response.json({ ok: true, echoed, id: row.id })
}

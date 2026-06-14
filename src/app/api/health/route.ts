import { getClaudeClient, getDb } from '@/server/deps'
import { ping } from '@/db/schema'

/**
 * Route handler trivial de saúde — a "porta mais alta" exercitada pelos testes de
 * integração da fundação. Síncrono de propósito: o streaming token-a-token da
 * geração é da issue #8 (ADR-0010); o seam `echo()` é não-streaming.
 */

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'refogando', status: 'up' })
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { message?: unknown }
  const message = typeof body.message === 'string' ? body.message : ''

  // Passa pelo seam do Claude (trocável por dublê nos testes) e toca o Postgres real.
  const echoed = await getClaudeClient().echo(message)
  const [row] = await getDb().insert(ping).values({ message: echoed }).returning()

  return Response.json({ ok: true, echoed, id: row.id })
}

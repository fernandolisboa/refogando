import { describe, expect, it } from 'vitest'
import { getDb } from '@/server/deps'
import { rateLimitWindow } from '@/db/schema'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'
import { createClientErrorIntake } from '@/server/http/client-error-intake'
import { consumeRateLimit } from '@/server/rate-limit/window'
import { POST } from '@/app/api/client-errors/route'

/**
 * Teto GLOBAL persistido do relato de erro do navegador (#648, ADR-0057): somando "instâncias" diferentes (duas
 * fábricas, cada uma com o seu teto em memória), o banco barra no teto global. A chave é só 'global': nenhum IP vai
 * para o banco (política item 3.7).
 */

const valid = { v: 1, tipo: 'janela', rota: '/pt-BR/recipes/bolo', erro: 'TypeError', msg: 'x' }
function post(ip: string): Request {
  return new Request('http://localhost/api/client-errors', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'x-real-ip': ip },
    body: JSON.stringify(valid),
  })
}

describe('client-errors — teto global persistido', () => {
  it('duas instâncias somam no mesmo teto do banco; sem IP gravado', async () => {
    const cap = async () =>
      (await consumeRateLimit(getDb(), { bucket: 'client_error_global', key: GLOBAL_LIMIT_KEY, limit: 3 })).allowed
    const lines: string[] = []
    const a = createClientErrorIntake({ log: (l) => lines.push(l), globalCap: cap })
    const b = createClientErrorIntake({ log: (l) => lines.push(l), globalCap: cap })
    const statuses = [
      (await a(post('11.0.0.1'))).status,
      (await b(post('11.0.0.2'))).status,
      (await a(post('11.0.0.3'))).status,
      (await b(post('11.0.0.4'))).status,
    ]
    expect(statuses).toEqual([204, 204, 204, 429])
    expect(lines).toHaveLength(3)
    const rows = await getDb().select().from(rateLimitWindow)
    expect(rows.map((r) => [r.bucket, r.key, r.count])).toEqual([['client_error_global', 'global', 3]])
  })

  it('a rota usa o teto do banco', async () => {
    expect((await POST(post('11.0.1.1'))).status).toBe(204)
    const rows = await getDb().select().from(rateLimitWindow)
    expect(rows.map((r) => r.bucket)).toEqual(['client_error_global'])
  })
})

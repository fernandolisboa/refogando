import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  // Relógio do app congelado no meio do minuto: a janela global de 1 min não pode virar no meio do teste. Só o `Date`
  // (o postgres-js usa `setTimeout` de verdade).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:00:30.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

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

  it('pedidos concorrentes contra o banco: o teto da instância vale (a vaga é reservada antes do await)', async () => {
    const cap = async () =>
      (await consumeRateLimit(getDb(), { bucket: 'client_error_global', key: GLOBAL_LIMIT_KEY, limit: 100 })).allowed
    const lines: string[] = []
    const intake = createClientErrorIntake({ log: (l) => lines.push(l), globalCap: cap, perInstancePerMinute: 4 })
    const statuses = await Promise.all(Array.from({ length: 12 }, (_, i) => intake(post(`11.0.2.${i + 1}`))))
    expect(statuses.filter((r) => r.status === 204)).toHaveLength(4)
    expect(lines.filter((l) => !l.includes('limite=atingido'))).toHaveLength(4)
    const [row] = await getDb().select().from(rateLimitWindow)
    expect(row.count).toBe(4) // quem a instância barrou nem foi ao banco
  })

  it('a rota usa o teto do banco', async () => {
    expect((await POST(post('11.0.1.1'))).status).toBe(204)
    const rows = await getDb().select().from(rateLimitWindow)
    expect(rows.map((r) => r.bucket)).toEqual(['client_error_global'])
  })
})

import { describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/health/route'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { ping } from '@/db/schema'

function postJson(body: unknown): Request {
  return new Request('http://localhost/api/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/health — integração pela porta mais alta', () => {
  it('GET responde liveness', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, service: 'refogando' })
  })

  it('POST passa pelo dublê do Claude e persiste no Postgres real', async () => {
    // Troca o seam do Claude por um dublê determinístico — sem tocar a rede.
    setClaudeClient(new FakeClaudeClient((text) => `eco:${text}`))

    const res = await POST(postJson({ message: 'oi' }))
    expect(res.status).toBe(200)

    const json = (await res.json()) as { ok: boolean; echoed: string; id: number }
    expect(json.ok).toBe(true)
    expect(json.echoed).toBe('eco:oi')
    expect(json.id).toBe(1) // RESTART IDENTITY após truncate → primeiro insert

    // Efeito observável no banco real.
    const rows = await getDb().select().from(ping)
    expect(rows).toHaveLength(1)
    expect(rows[0].message).toBe('eco:oi')
    expect(rows[0].createdAt).toBeInstanceOf(Date)
  })

  it('POST sem dublê usa o cliente real (echo puro)', async () => {
    const res = await POST(postJson({ message: 'arroz' }))
    const json = (await res.json()) as { echoed: string }
    expect(json.echoed).toBe('arroz')
  })

  it('POST com corpo não-JSON degrada para mensagem vazia (200)', async () => {
    const res = await POST(
      new Request('http://localhost/api/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'isto não é json',
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { echoed: string; id: number }
    expect(json.echoed).toBe('')
    expect(json.id).toBe(1)
  })

  it('POST sem campo message trata como string vazia (200)', async () => {
    const res = await POST(postJson({ outra: 'coisa' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { echoed: string }
    expect(json.echoed).toBe('')
  })
})

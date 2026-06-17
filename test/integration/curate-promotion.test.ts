import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET as promotionRoute } from '@/app/api/curate/promotion/route'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import { seedIngredient } from '../helpers/recipes'
import { seedBriefing, seedBriefingItem } from '../helpers/generation'

/**
 * Lista de PROMOÇÃO de ingredientes livres recorrentes (issue #19, AC5) pela porta MAIS
 * ALTA. READ-ONLY: agrega briefing_item LIVRES (ingredient_id NULL) por chave
 * normalizada, filtra por threshold (≥2), ordena por count desc. Reusa
 * seedBriefing/seedBriefingItem (strength NOT-NULL exigido).
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function curadorHeaders(): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
  return headers
}

function get(headers?: Headers): Promise<Response> {
  return promotionRoute(new Request('http://localhost/api/curate/promotion', { headers }))
}

/** N itens livres (ingredient_id NULL) com o mesmo rawText, espalhados por briefings. */
async function seedFreeItems(rawText: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const b = await seedBriefing({})
    await seedBriefingItem({ briefingId: b, strength: 'required', rawText, ingredientId: null })
  }
}

describe('GET /api/curate/promotion #19 — AC5', () => {
  it('matriz de gating', async () => {
    expect((await get()).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    expect((await get(u)).status).toBe(403)
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await get(c)).status).toBe(200)
    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await get(a)).status).toBe(200)
    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await get(d)).status).toBe(401)
  })

  it('agrega por normalizeText (caixa/acento colapsam), ordena por count desc, threshold ≥2', async () => {
    const headers = await curadorHeaders()
    // 'manjericão' (x3) + 'Manjericão' (x2) colapsam via normalizeText → 5.
    await seedFreeItems('manjericão', 3)
    await seedFreeItems('Manjericão', 2)
    // 'sal' x1 (abaixo do threshold → NÃO aparece).
    await seedFreeItems('sal', 1)
    // 'cebola' x2 (no threshold → aparece).
    await seedFreeItems('cebola', 2)
    // item já canônico (ingredient_id NOT NULL) — DEVE ser excluído.
    const canon = await seedIngredient({ slug: `c-${crypto.randomUUID()}` })
    const b = await seedBriefing({})
    await seedBriefingItem({ briefingId: b, strength: 'required', rawText: 'alho', ingredientId: canon })

    const res = await get(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { promotion: { rawText: string; count: number }[] }

    // manjericão (5) antes de cebola (2); sal e alho ausentes.
    expect(body.promotion).toHaveLength(2)
    expect(body.promotion[0].count).toBe(5)
    expect(body.promotion[0].rawText.toLowerCase()).toContain('manjeric')
    expect(body.promotion[1].count).toBe(2)
    expect(body.promotion[1].rawText).toBe('cebola')

    const allRaw = body.promotion.map((p) => p.rawText.toLowerCase())
    expect(allRaw).not.toContain('sal')
    expect(allRaw).not.toContain('alho')
  })

  it('exclui itens já canônicos da contagem', async () => {
    const headers = await curadorHeaders()
    const canon = await seedIngredient({ slug: `c-${crypto.randomUUID()}` })
    // 'tomate' x2 mas ambos já canônicos → não aparece.
    for (let i = 0; i < 2; i++) {
      const b = await seedBriefing({})
      await seedBriefingItem({ briefingId: b, strength: 'required', rawText: 'tomate', ingredientId: canon })
    }
    const body = (await (await get(headers)).json()) as { promotion: { rawText: string }[] }
    expect(body.promotion.map((p) => p.rawText.toLowerCase())).not.toContain('tomate')
  })

  it('lista vazia → 200 { promotion: [] }', async () => {
    const headers = await curadorHeaders()
    const res = await get(headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ promotion: [] })
  })
})

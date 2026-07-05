import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { POST } from '@/app/api/admin/translations/retranslate/route'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import { FakeTranslator } from '@/server/translation/translator'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { ensureTranslation } from '@/server/recipe/translation'
import { recipeTranslation } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * `POST /api/admin/translations/retranslate` (#499, ADR-0031 dec.5) — ADMIN-ONLY. Espelha
 * `embedding-backfill.test.ts` (#119): gate de papel, recompute+idempotência, clamp/retomada de
 * `limit`. A lógica de defasada/intocada é testada a fundo em `translation-retranslate.test.ts`
 * (chamando `retranslateOutdated` direto); aqui só a fiação da rota (auth + wiring HTTP).
 */

const DIM = 1536

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function retranslate(headers?: Headers, limit?: number): Promise<Response> {
  const qs = limit != null ? `?limit=${limit}` : ''
  return POST(new Request(`http://localhost/api/admin/translations/retranslate${qs}`, { method: 'POST', headers }))
}

async function seedEligibleDerived(titulo: string): Promise<string> {
  const db = getDb()
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  await ensureTranslation(db, recipeId, 'en-US')
  // Fonte muda ⇒ a derivada en-US fica defasada (mantém-se intocada — ninguém a editou).
  await db
    .update(recipeTranslation)
    .set({ titulo: `${titulo} v2` })
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, 'pt-BR')))
  return recipeId
}

type Body = { retranslated: number; degraded: number; remaining: number }

describe('POST /api/admin/translations/retranslate — worker (#499)', () => {
  it('gate de papel: anon 401, usuario/curador 403, admin 200', async () => {
    const { headers: usuarioH } = await seedSessionHeaders({ email: 'rt-user@ex.com', role: 'usuario' })
    const { headers: curadorH } = await seedSessionHeaders({ email: 'rt-cur@ex.com', role: 'curador' })
    const { headers: adminH } = await seedSessionHeaders({ email: 'rt-admin@ex.com', role: 'admin' })
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))

    expect((await retranslate()).status).toBe(401)
    expect((await retranslate(usuarioH)).status).toBe(403)
    expect((await retranslate(curadorH)).status).toBe(403)
    expect((await retranslate(adminH)).status).toBe(200)
  })

  it('re-traduz os candidatos + idempotente (2ª chamada não tem o que fazer)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rt-run@ex.com', role: 'admin' })
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const a = await seedEligibleDerived('Ovos mexidos')
    const b = await seedEligibleDerived('Panqueca de banana')

    const r1 = (await (await retranslate(headers)).json()) as Body
    expect(r1.retranslated).toBe(2)
    expect(r1.degraded).toBe(0)
    expect(r1.remaining).toBe(0)

    const [ta] = await getDb()
      .select({ titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, a), eq(recipeTranslation.locale, 'en-US')))
    expect(ta.titulo).toBe('Ovos mexidos v2')
    const [tb] = await getDb()
      .select({ titulo: recipeTranslation.titulo })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, b), eq(recipeTranslation.locale, 'en-US')))
    expect(tb.titulo).toBe('Panqueca de banana v2')

    // Idempotente: nada mais defasado-e-intocado a fazer.
    const r2 = (await (await retranslate(headers)).json()) as Body
    expect(r2).toEqual({ retranslated: 0, degraded: 0, remaining: 0 })
  })

  it('limit capa o lote e `remaining` guia a retomada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rt-limit@ex.com', role: 'admin' })
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    await seedEligibleDerived('R1')
    await seedEligibleDerived('R2')
    await seedEligibleDerived('R3')

    const r1 = (await (await retranslate(headers, 2)).json()) as Body
    expect(r1.retranslated).toBe(2)
    expect(r1.remaining).toBe(1)

    const r2 = (await (await retranslate(headers, 2)).json()) as Body
    expect(r2.retranslated).toBe(1)
    expect(r2.remaining).toBe(0)
  })
})

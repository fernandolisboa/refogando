import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/me/recipes/route'
import {
  seedRecipe,
  seedTranslation,
  seedRemovedFromPool,
} from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'
import type { RecipeListItem } from '@/domain/recipe-list-read'

/**
 * "Minhas criações" pela porta mais alta — o handler GET /api/me/recipes (issue #61).
 * INVARIANTE central: o dono vê TUDO o que é seu (private, playful E removida-do-pool),
 * NUNCA o de outro nem o catálogo; Visitante ⇒ 401. `setup.ts` aponta o DI e trunca antes.
 */

function getAs(headers: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return GET(new Request(`http://localhost/api/me/recipes${qs}`, { headers }))
}

/** Semeia uma Receita do dono com tradução pt-BR e devolve o id. */
async function seedOwn(input: {
  ownerId: string
  titulo: string
  visibility?: 'private' | 'public'
  resultKind?: 'success' | 'degraded' | 'playful'
  lineageKind?: 'regenerated' | 'edited' | null
}): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_structured',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? 'private',
    resultKind: input.resultKind ?? 'success',
    lineageKind: input.lineageKind ?? null,
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: input.titulo,
    provenance: 'escrita_por_pessoa',
  })
  return id
}

describe('GET /api/me/recipes — Minhas criações (#61)', () => {
  it('401 para Visitante (sem sessão)', async () => {
    const res = await GET(new Request('http://localhost/api/me/recipes'))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('devolve SÓ as criações do caller, incluindo private, playful E removida-do-pool', async () => {
    const me = await seedSessionHeaders({ email: `mine-${crypto.randomUUID()}@ex.com` })
    const outro = await seedSessionHeaders({ email: `other-${crypto.randomUUID()}@ex.com` })
    const curador = await seedSessionHeaders({
      email: `cur-${crypto.randomUUID()}@ex.com`,
      role: 'curador',
    })

    // Minhas: uma private (success), uma pública, uma playful (sempre private), uma removida.
    const priv = await seedOwn({ ownerId: me.userId, titulo: 'Minha privada' })
    const pub = await seedOwn({ ownerId: me.userId, titulo: 'Minha pública', visibility: 'public' })
    const playful = await seedOwn({
      ownerId: me.userId,
      titulo: 'Minha de zoeira',
      resultKind: 'playful',
    })
    const removida = await seedOwn({ ownerId: me.userId, titulo: 'Minha removida', visibility: 'public' })
    await seedRemovedFromPool({ recipeId: removida, curatorId: curador.userId })

    // De OUTRO usuário (não deve aparecer) + um item de catálogo (owner NULL).
    const alheia = await seedOwn({ ownerId: outro.userId, titulo: 'Da outra pessoa', visibility: 'public' })
    const catalogo = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId: catalogo,
      locale: 'pt-BR',
      titulo: 'Feijoada do catálogo',
      provenance: 'escrita_por_pessoa',
    })

    const res = await getAs(me.headers, 'pt-BR')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { recipes: RecipeListItem[] }

    const ids = body.recipes.map((r) => r.id).sort()
    expect(ids).toEqual([priv, pub, playful, removida].sort())
    // Não vaza receita alheia nem o catálogo.
    expect(ids).not.toContain(alheia)
    expect(ids).not.toContain(catalogo)

    // A playful e a removida DEVEM aparecer (gate de pool NÃO se aplica ao dono).
    const playfulItem = body.recipes.find((r) => r.id === playful)
    expect(playfulItem?.resultKind).toBe('playful')
    const removidaItem = body.recipes.find((r) => r.id === removida)
    expect(removidaItem?.visibility).toBe('public') // remover-do-pool ≠ despublicar
    expect(removidaItem?.moderationRemovida).toBe(true) // sinaliza "fora do acervo" pro dono
    // Uma receita NÃO removida não carrega o sinal.
    expect(body.recipes.find((r) => r.id === priv)?.moderationRemovida).toBe(false)
  })

  it('ordena por updated_at DESC (mais recente primeiro) e resolve o título exibido', async () => {
    const me = await seedSessionHeaders({ email: `order-${crypto.randomUUID()}@ex.com` })
    const a = await seedOwn({ ownerId: me.userId, titulo: 'Primeira' })
    // Garante updated_at distinto e crescente para B (semeada depois).
    await new Promise((r) => setTimeout(r, 5))
    const b = await seedOwn({ ownerId: me.userId, titulo: 'Segunda' })

    const res = await getAs(me.headers, 'pt-BR')
    const body = (await res.json()) as { recipes: RecipeListItem[] }
    // B (mais recente) antes de A.
    const order = body.recipes.map((r) => r.id)
    expect(order.indexOf(b)).toBeLessThan(order.indexOf(a))
    expect(body.recipes.find((r) => r.id === a)?.name).toBe('Primeira')
  })

  it('lista vazia quando o caller não criou nada', async () => {
    const me = await seedSessionHeaders({ email: `empty-${crypto.randomUUID()}@ex.com` })
    const res = await getAs(me.headers, 'pt-BR')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ recipes: [] })
  })
})

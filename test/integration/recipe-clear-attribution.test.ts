import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/recipes/[id]/clear-attribution/route'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import type { RecipeView } from '@/domain/recipe-read'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Remover o nome da fonte (#272 LGPD, ADR-0019) pela porta MAIS ALTA (POST /api/recipes/[id]/
 * clear-attribution). Owner-gated 404-leak-safe (ADR-0011, NUNCA 403): zera SÓ `source_name` (a
 * atribuição cai pro host; `source_url` + `origin` ficam), idempotente (no-op não bumpa updatedAt).
 */

const SRC = 'https://exemplo.com/receitas/bolo'

function clearPost(id: string, headers?: Headers): Promise<Response> {
  return POST(new Request(`http://localhost/api/recipes/${id}/clear-attribution`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Semeia uma importada do `owner` com atribuição (sourceUrl/sourceName) — seedRecipe não tem esses campos. */
async function seedImported(input: { ownerId: string; sourceName: string | null; sourceUrl: string | null }): Promise<string> {
  const id = await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'private', ownerId: input.ownerId })
  await getDb().update(recipe).set({ sourceUrl: input.sourceUrl, sourceName: input.sourceName }).where(eq(recipe.id, id))
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo Importado', provenance: 'automatica_nao_revisada', slug: 'bolo-importado' })
  return id
}

async function loadSource(id: string) {
  const [row] = await getDb()
    .select({ origin: recipe.origin, sourceName: recipe.sourceName, sourceUrl: recipe.sourceUrl, updatedAt: recipe.updatedAt })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row
}

describe('POST /api/recipes/[id]/clear-attribution (#272 LGPD)', () => {
  it('dono de web_imported com nome humano → 200; zera sourceName (url + origin preservados); view.source sem name', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-ok@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    const res = await clearPost(id, headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.origin).toBe('web_imported')
    expect(view.source).toEqual({ url: SRC }) // name removido ⇒ atribuição cai pro host

    const row = await loadSource(id)
    expect(row.sourceName).toBeNull()
    expect(row.sourceUrl).toBe(SRC) // URL PRESERVADA
    expect(row.origin).toBe('web_imported') // NUNCA toca origin
  })

  it('não-dono → 404 leak-safe; sourceName INALTERADO', async () => {
    const { userId } = await seedSessionHeaders({ email: 'clear-owner@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })
    const { headers: intruso } = await seedSessionHeaders({ email: 'clear-intruso@ex.com' })

    const res = await clearPost(id, intruso)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('not_found')
    expect((await loadSource(id)).sourceName).toBe('Cozinha da Vovó') // nem vaza nem muta
  })

  it('catálogo (ownerId NULL) → 404 (ninguém é dono)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'clear-catalog@ex.com' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', visibility: 'public', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Catálogo', provenance: 'automatica_nao_revisada', slug: 'catalogo-x' })

    expect((await clearPost(id, headers)).status).toBe(404)
  })

  it('id inexistente (uuid válido sem linha) → 404; id malformado → 404 (antes do DB)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'clear-404@ex.com' })
    expect((await clearPost('00000000-0000-4000-8000-000000000000', headers)).status).toBe(404)
    expect((await clearPost('nao-uuid', headers)).status).toBe(404)
  })

  it('anon (sem sessão) → 401, zero efeito', async () => {
    const { userId } = await seedSessionHeaders({ email: 'clear-anon@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    const res = await clearPost(id) // sem headers de sessão
    expect(res.status).toBe(401)
    expect((await loadSource(id)).sourceName).toBe('Cozinha da Vovó') // intacto
  })

  it('idempotente: 2ª remoção (sourceName já null) → 200 no-op, SEM bump de updatedAt', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-idem@ex.com' })
    const id = await seedImported({ ownerId: userId, sourceName: 'Cozinha da Vovó', sourceUrl: SRC })

    expect((await clearPost(id, headers)).status).toBe(200) // 1ª: limpa
    const afterFirst = await loadSource(id)
    expect(afterFirst.sourceName).toBeNull()

    expect((await clearPost(id, headers)).status).toBe(200) // 2ª: no-op
    const afterSecond = await loadSource(id)
    expect(afterSecond.sourceName).toBeNull()
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt) // no-op NÃO bumpa updatedAt
  })

  it('dono de receita NÃO importada (ai_structured) → 200 no-op; origin intacto', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'clear-ai@ex.com' })
    const id = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'IA', provenance: 'automatica_nao_revisada', slug: 'ia-x' })

    const res = await clearPost(id, headers)
    expect(res.status).toBe(200) // dono ⇒ ok, mas nada a limpar (não é web_imported)
    expect((await loadSource(id)).origin).toBe('ai_structured')
  })
})

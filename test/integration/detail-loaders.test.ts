import { describe, it, expect } from 'vitest'
import { GET as getProfileRoute } from '@/app/api/u/[handle]/route'
import { GET as getRecipeRoute } from '@/app/api/recipes/[id]/route'
import { getDb } from '@/server/deps'
import { loadPublicProfile } from '@/server/user/public-profile'
import { loadRecipeDetailView } from '@/server/recipe/detail-view'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Loaders COMPARTILHADOS rota↔página (sem self-fetch HTTP): `loadPublicProfile` (perfil público) e
 * `loadRecipeDetailView` (detalhe por UUID, caminho do dono). Provamos (1) os desfechos leak-safe
 * (`null` ⇒ a borda dá 404) e (2) a EQUIVALÊNCIA com o JSON da rota: o valor do loader é JSON-puro
 * (sem `Date`/`undefined`), então a página que o passa direto aos client components entrega o MESMO
 * que o antigo `res.json()` entregava.
 */

/** JSON-puro: o round-trip JSON é idêntico (toStrictEqual pega `Date`→string e chaves `undefined`). */
function expectJsonPure(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
}

async function seedOwnedRecipe(
  ownerId: string,
  visibility: 'public' | 'private',
  titulo: string,
): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId,
    visibility,
    resultKind: 'success',
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

describe('loadPublicProfile', () => {
  it('handle inexistente / vazio ⇒ null (404 leak-safe)', async () => {
    expect(await loadPublicProfile(getDb(), 'ninguem-aqui', 'pt-BR')).toBeNull()
    expect(await loadPublicProfile(getDb(), '   ', 'pt-BR')).toBeNull()
  })

  it('conta soft-deletada ⇒ null (não vaza perfil desativado)', async () => {
    await seedUser({ email: 'del@ex.com', handle: 'desativada', deletedAt: new Date() })
    expect(await loadPublicProfile(getDb(), 'desativada', 'pt-BR')).toBeNull()
  })

  it('perfil vivo ⇒ DTO JSON-puro, idêntico ao corpo do GET /api/u/[handle] (handle normalizado)', async () => {
    const ownerId = await seedUser({ email: 'ana@ex.com', name: 'Ana', handle: 'ana-cozinha' })
    await seedOwnedRecipe(ownerId, 'public', 'Bolo de fubá')
    await seedOwnedRecipe(ownerId, 'private', 'Segredo')

    const profile = await loadPublicProfile(getDb(), '  ANA-Cozinha ', 'pt-BR')
    expect(profile).not.toBeNull()
    expect(profile?.handle).toBe('ana-cozinha')
    expect(profile?.recipes.map((r) => r.displayedTitle)).toEqual(['Bolo de fubá'])
    expectJsonPure(profile)

    const res = await getProfileRoute(
      new Request('http://localhost/api/u/ana-cozinha?locale=pt-BR'),
      { params: Promise.resolve({ handle: 'ana-cozinha' }) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(profile)
  })
})

describe('loadRecipeDetailView', () => {
  it('id malformado / ausente ⇒ null', async () => {
    const headers = new Headers()
    expect(
      await loadRecipeDetailView(getDb(), { id: 'nao-uuid', requestLocale: 'pt-BR', headers }),
    ).toBeNull()
    expect(
      await loadRecipeDetailView(getDb(), {
        id: '00000000-0000-0000-0000-000000000000',
        requestLocale: 'pt-BR',
        headers,
      }),
    ).toBeNull()
  })

  it('privada: anônimo e não-dono ⇒ null; dono (via headers) ⇒ view de gestão', async () => {
    const owner = await seedSessionHeaders({ email: 'dono@ex.com' })
    const other = await seedSessionHeaders({ email: 'outro@ex.com' })
    const id = await seedOwnedRecipe(owner.userId, 'private', 'Minha privada')

    expect(
      await loadRecipeDetailView(getDb(), { id, requestLocale: 'pt-BR', headers: new Headers() }),
    ).toBeNull()
    expect(
      await loadRecipeDetailView(getDb(), { id, requestLocale: 'pt-BR', headers: other.headers }),
    ).toBeNull()

    const view = await loadRecipeDetailView(getDb(), {
      id,
      requestLocale: 'pt-BR',
      headers: owner.headers,
    })
    expect(view).not.toBeNull()
    expect(view?.name).toBe('Minha privada')
    expect(view?.canManage).toBe(true)
    expect(view?.visibility).toBe('private')
    expect(view?.viewerSaved).toBe(false)
    expectJsonPure(view)

    // Mesmo corpo que a rota entrega ao dono (a página antes recebia exatamente este JSON).
    const res = await getRecipeRoute(
      new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers: owner.headers }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(view)
  })

  it('pública sem cookie ⇒ view anônima (sem viewerSaved/canManage)', async () => {
    const owner = await seedSessionHeaders({ email: 'pub@ex.com' })
    const id = await seedOwnedRecipe(owner.userId, 'public', 'Receita aberta')

    const view = await loadRecipeDetailView(getDb(), {
      id,
      requestLocale: 'pt-BR',
      headers: new Headers(),
    })
    expect(view?.name).toBe('Receita aberta')
    expect(view).not.toHaveProperty('viewerSaved')
    expect(view).not.toHaveProperty('canManage')
    expectJsonPure(view)
  })

  it('pública COM cookie ⇒ resolve o viewer: dono ganha gestão; outro logado só viewerSaved', async () => {
    const owner = await seedSessionHeaders({ email: 'dono-pub@ex.com' })
    const other = await seedSessionHeaders({ email: 'leitor@ex.com' })
    const id = await seedOwnedRecipe(owner.userId, 'public', 'Pública do dono')

    const asOwner = await loadRecipeDetailView(getDb(), { id, requestLocale: 'pt-BR', headers: owner.headers })
    expect(asOwner?.canManage).toBe(true)
    expect(asOwner?.viewerSaved).toBe(false)
    expectJsonPure(asOwner)

    const asOther = await loadRecipeDetailView(getDb(), { id, requestLocale: 'pt-BR', headers: other.headers })
    expect(asOther?.viewerSaved).toBe(false)
    expect(asOther).not.toHaveProperty('canManage')
    expectJsonPure(asOther)
  })
})

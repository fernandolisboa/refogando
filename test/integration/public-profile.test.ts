import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET } from '@/app/api/u/[handle]/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedUser } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRemovedFromPool } from '../helpers/recipes'

/**
 * Perfil PÚBLICO (#129) pela porta MAIS ALTA — handler GET de `/api/u/[handle]`. Visitante
 * ANÔNIMO (ADR-0011, nenhuma sessão): vê nome/avatar/bio/links + as Receitas PÚBLICAS daquela
 * pessoa. Privadas, playful e removidas-do-pool NUNCA aparecem; handle inexistente ⇒ 404. Cada
 * AC tem ao menos um controle negativo NÃO-vacuamente-verde.
 */

type ProfileRecipe = { recipeId: string; displayedTitle: string; origin: string }
type PublicProfile = {
  name: string
  handle: string
  image: string | null
  bio: string | null
  links: { tipo: string; url: string }[]
  recipes: ProfileRecipe[]
}

function profileReq(handle: string, locale = 'pt-BR'): Promise<Response> {
  // ANÔNIMO: nenhum header de sessão (o perfil é o mesmo p/ todos).
  return GET(
    new Request(`http://localhost/api/u/${encodeURIComponent(handle)}?locale=${locale}`),
    { params: Promise.resolve({ handle }) },
  )
}

async function profileBody(handle: string, locale = 'pt-BR'): Promise<PublicProfile> {
  const res = await profileReq(handle, locale)
  expect(res.status).toBe(200)
  return (await res.json()) as PublicProfile
}

const recipeIds = (p: PublicProfile): string[] => p.recipes.map((r) => r.recipeId)

/** Cria uma Receita do dono `ownerId` com título pt-BR; devolve o id. */
async function seedOwnedRecipe(input: {
  ownerId: string
  titulo: string
  visibility?: 'public' | 'private'
  resultKind?: 'success' | 'degraded' | 'playful'
}): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? 'public',
    resultKind: input.resultKind ?? 'success',
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: input.titulo,
    provenance: 'escrita_por_pessoa',
  })
  return id
}

describe('GET /api/u/[handle] — perfil público (#129)', () => {
  it('handle inexistente ⇒ 404 not_found', async () => {
    const res = await profileReq('nao-existe-mesmo-xyz')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('devolve a identidade pública (nome, handle, image, bio, links) — nunca email/id', async () => {
    const handle = `chef-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({
      email: `pub-id-${crypto.randomUUID()}@ex.com`,
      name: 'Chef Teste',
      handle,
    })
    // bio + image + links gravados direto (a borda já os validou em #124/#126/#127).
    await getDb()
      .update(users)
      .set({
        bio: 'Cozinho todo dia.',
        image: 'https://lh3.googleusercontent.com/avatar.jpg',
        links: [{ tipo: 'instagram', url: 'https://instagram.com/chef' }],
      })
      .where(eq(users.id, ownerId))

    const body = await profileBody(handle)
    expect(body.name).toBe('Chef Teste')
    expect(body.handle).toBe(handle)
    expect(body.image).toBe('https://lh3.googleusercontent.com/avatar.jpg')
    expect(body.bio).toBe('Cozinho todo dia.')
    expect(body.links).toEqual([{ tipo: 'instagram', url: 'https://instagram.com/chef' }])
    // LEAK-SAFETY: o contrato público NÃO carrega email/id/role.
    const keys = Object.keys(body)
    expect(keys).not.toContain('email')
    expect(keys).not.toContain('id')
    expect(keys).not.toContain('role')
  })

  it('lista SÓ as receitas PÚBLICAS do dono (privada/playful/removida EXCLUÍDAS)', async () => {
    const handle = `chef-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `pub-recs-${crypto.randomUUID()}@ex.com`, handle })
    const curator = await seedUser({
      email: `pub-cur-${crypto.randomUUID()}@ex.com`,
      role: 'curador',
    })

    const pub = await seedOwnedRecipe({ ownerId, titulo: 'Pública visível' })
    const priv = await seedOwnedRecipe({
      ownerId,
      titulo: 'Privada secreta',
      visibility: 'private',
    })
    // Playful é SEMPRE private (CHECK recipe_playful_private_chk) — já fora do pool pela
    // visibilidade; o gate de pool a exclui por DOIS motivos (private + playful).
    const playful = await seedOwnedRecipe({
      ownerId,
      titulo: 'Zoeira impossível',
      visibility: 'private',
      resultKind: 'playful',
    })
    const removed = await seedOwnedRecipe({ ownerId, titulo: 'Removida do pool' })
    await seedRemovedFromPool({ recipeId: removed, curatorId: curator })

    const body = await profileBody(handle)
    const ids = recipeIds(body)
    // POSITIVO: a pública aparece, com o título exibido resolvido.
    expect(ids).toContain(pub)
    expect(body.recipes.find((r) => r.recipeId === pub)?.displayedTitle).toBe('Pública visível')
    // NEGATIVOS não-vácuos: privada, playful e removida-do-pool NUNCA aparecem.
    expect(ids).not.toContain(priv)
    expect(ids).not.toContain(playful)
    expect(ids).not.toContain(removed)
  })

  it('NÃO vaza receitas de OUTRO dono nem o catálogo (escopo por owner_id)', async () => {
    const handleA = `dono-a-${crypto.randomUUID().slice(0, 8)}`
    const handleB = `dono-b-${crypto.randomUUID().slice(0, 8)}`
    const ownerA = await seedUser({ email: `a-${crypto.randomUUID()}@ex.com`, handle: handleA })
    const ownerB = await seedUser({ email: `b-${crypto.randomUUID()}@ex.com`, handle: handleB })

    const aPub = await seedOwnedRecipe({ ownerId: ownerA, titulo: 'Da pessoa A' })
    const bPub = await seedOwnedRecipe({ ownerId: ownerB, titulo: 'Da pessoa B' })
    // Catálogo (owner NULL) — NUNCA é "criação" de ninguém.
    const cat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId: cat,
      locale: 'pt-BR',
      titulo: 'Catálogo editorial',
      provenance: 'escrita_por_pessoa',
    })

    const body = await profileBody(handleA)
    const ids = recipeIds(body)
    expect(ids).toContain(aPub)
    expect(ids).not.toContain(bPub)
    expect(ids).not.toContain(cat)
  })

  it('perfil sem receitas públicas ⇒ recipes vazio (200, não 404)', async () => {
    const handle = `vazio-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `vazio-${crypto.randomUUID()}@ex.com`, handle })
    // Só uma privada — o pool fica vazio para o Visitante.
    await seedOwnedRecipe({ ownerId, titulo: 'Privada só minha', visibility: 'private' })

    const body = await profileBody(handle)
    expect(body.recipes).toEqual([])
  })

  it('conta soft-deletada ⇒ 404 (perfil não aparece)', async () => {
    const handle = `deletado-${crypto.randomUUID().slice(0, 8)}`
    await seedUser({
      email: `del-${crypto.randomUUID()}@ex.com`,
      handle,
      deletedAt: new Date(),
    })
    const res = await profileReq(handle)
    expect(res.status).toBe(404)
  })

  it('handle é case-insensitive na resolução (normalizado como na gravação)', async () => {
    const handle = `casing-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `case-${crypto.randomUUID()}@ex.com`, handle })
    await seedOwnedRecipe({ ownerId, titulo: 'Pública' })
    // Pede com MAIÚSCULAS — a rota normaliza (lower) antes de consultar.
    const body = await profileBody(handle.toUpperCase())
    expect(body.handle).toBe(handle)
    expect(body.recipes).toHaveLength(1)
  })
})

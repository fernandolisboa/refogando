import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET } from '@/app/api/u/[handle]/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedUser } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedRemovedFromPool,
  seedRecipeImage,
} from '../helpers/recipes'

/**
 * Perfil PÚBLICO (#129) pela porta MAIS ALTA — handler GET de `/api/u/[handle]`. Visitante
 * ANÔNIMO (ADR-0011, nenhuma sessão): vê nome/avatar/bio/links + as Receitas PÚBLICAS daquela
 * pessoa. Privadas, playful e removidas-do-pool NUNCA aparecem; handle inexistente ⇒ 404. Cada
 * AC tem ao menos um controle negativo NÃO-vacuamente-verde.
 */

// #231 (ADR-0020): o slug do locale pedido entra no item pro card linkar o canônico; ausente quando
// a Receita não tem tradução COM slug naquele locale (fallback por UUID).
// #130/#132 (BUG 2): a foto de capa entra no item — `imageUrl` (blob PÚBLICO) + `imageAiGenerated`.
type ProfileRecipe = {
  recipeId: string
  displayedTitle: string
  origin: string
  slug?: string
  imageUrl?: string
  imageAiGenerated?: boolean
}
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
  // #231: locale original (default pt-BR) + slug per-locale opcional — pra testar o slug do DTO.
  originalLocale?: string
  slug?: string | null
  // BUG 2: origin é 'ai_chat' por padrão; o caso web_imported força 'web_imported' p/ provar o gate.
  origin?: 'ai_chat' | 'web_imported'
}): Promise<string> {
  const id = await seedRecipe({
    origin: input.origin ?? 'ai_chat',
    originalLocale: input.originalLocale ?? 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? 'public',
    resultKind: input.resultKind ?? 'success',
  })
  await seedTranslation({
    recipeId: id,
    locale: input.originalLocale ?? 'pt-BR',
    titulo: input.titulo,
    provenance: 'escrita_por_pessoa',
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
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

  // WIRING SQL→DTO do slug (#231, ADR-0020): prova que `recipe_translation.slug` projetado pelo loader
  // (list-public.ts → slugByLocale) chega ao item do perfil, escolhido pelo requestLocale. Sem isto, a
  // suíte ficaria verde (builder puro recebe o slug à mão) e o card do perfil cairia no fallback UUID.
  it('#231: item carrega o slug do locale pedido; sem tradução no locale → slug ausente', async () => {
    const handle = `slug-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `slug-${crypto.randomUUID()}@ex.com`, handle })
    // (a) pública pt-BR COM slug ⇒ item.slug === o slug daquele locale.
    const comSlug = await seedOwnedRecipe({ ownerId, titulo: 'Pública com slug', slug: 'publica-com-slug' })
    // (b) pública com original en-US COM slug; pedimos pt-BR ⇒ slugByLocale não tem pt-BR ⇒ slug ausente.
    const semNoLocale = await seedOwnedRecipe({
      ownerId,
      titulo: 'Public English only',
      originalLocale: 'en-US',
      slug: 'public-english-only',
    })

    const body = await profileBody(handle, 'pt-BR')
    const a = body.recipes.find((r) => r.recipeId === comSlug)
    expect(a?.slug).toBe('publica-com-slug')
    const b = body.recipes.find((r) => r.recipeId === semNoLocale)
    expect(b, 'esperava a pública só-en-US no perfil (é pública)').toBeDefined()
    // requestLocale pt-BR sem slug ⇒ o builder não acha slug no mapa ⇒ DTO sem slug (fallback UUID).
    expect(b!.slug).toBeUndefined()
  })

  // BUG 2 (#130/#132): a foto de capa do perfil. WIRING SQL→DTO: prova que o LEFT JOIN em
  // recipe_image (via recipe.image_id, com moderated_at IS NULL) chega ao item. Sem isto, o card do
  // perfil cai no placeholder mesmo com a receita TENDO imagem (o bug reportado pelo dono).
  it('#130: receita com foto ⇒ item.imageUrl === blob público (sem image_id/provenance no DTO)', async () => {
    const handle = `img-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `img-${crypto.randomUUID()}@ex.com`, handle })
    const blob = `https://abc.public.blob.vercel-storage.com/recipes/${crypto.randomUUID()}.webp`
    const comFoto = await seedOwnedRecipe({ ownerId, titulo: 'Com foto' })
    await seedRecipeImage({ recipeId: comFoto, blobUrl: blob, provenance: 'user_photo' })

    const body = await profileBody(handle)
    const r = body.recipes.find((x) => x.recipeId === comFoto)
    expect(r?.imageUrl).toBe(blob)
    // foto do dono NÃO é gerada por IA ⇒ sem selo.
    expect(r?.imageAiGenerated).toBeUndefined()
    // LEAK-SAFETY: o DTO da imagem expõe SÓ o blob público — nunca o image_id/provenance internos.
    const keys = Object.keys(r!)
    expect(keys).not.toContain('image_id')
    expect(keys).not.toContain('imageId')
    expect(keys).not.toContain('imageProvenance')
    expect(keys).not.toContain('provenance')
  })

  it('#130: receita SEM foto ⇒ imageUrl AUSENTE (negativo não-vácuo)', async () => {
    const handle = `noimg-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `noimg-${crypto.randomUUID()}@ex.com`, handle })
    const semFoto = await seedOwnedRecipe({ ownerId, titulo: 'Sem foto' })

    const body = await profileBody(handle)
    const r = body.recipes.find((x) => x.recipeId === semFoto)
    expect(r, 'a pública sem foto ainda aparece no perfil').toBeDefined()
    expect('imageUrl' in r!).toBe(false)
  })

  it("#132: foto gerada por IA ⇒ imageAiGenerated true (dirige o selo no card)", async () => {
    const handle = `ai-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `ai-${crypto.randomUUID()}@ex.com`, handle })
    const gerada = await seedOwnedRecipe({ ownerId, titulo: 'Gerada por IA' })
    await seedRecipeImage({ recipeId: gerada, provenance: 'ai_generated' })

    const body = await profileBody(handle)
    const r = body.recipes.find((x) => x.recipeId === gerada)
    expect(r?.imageUrl).toBeTruthy()
    expect(r?.imageAiGenerated).toBe(true)
  })

  it('#133: imagem MODERADA ⇒ a receita aparece mas SEM imageUrl (gate moderated_at IS NULL)', async () => {
    const handle = `mod-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `mod-${crypto.randomUUID()}@ex.com`, handle })
    const curator = await seedUser({ email: `mod-cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const moderada = await seedOwnedRecipe({ ownerId, titulo: 'Com foto moderada' })
    await seedRecipeImage({ recipeId: moderada, moderated: { curatorId: curator } })

    const body = await profileBody(handle)
    const r = body.recipes.find((x) => x.recipeId === moderada)
    // POSITIVO: a receita ainda está no perfil (a moderação some a IMAGEM, não a receita).
    expect(r, 'a receita aparece — só a imagem moderada some').toBeDefined()
    // NEGATIVO não-vácuo: o gate moderated_at IS NULL na cláusula ON zera a imagem.
    expect('imageUrl' in r!).toBe(false)
  })

  it('ADR-0019: web_imported forçada public COM imagem ⇒ AUSENTE do perfil (gate origin)', async () => {
    const handle = `web-${crypto.randomUUID().slice(0, 8)}`
    const ownerId = await seedUser({ email: `web-${crypto.randomUUID()}@ex.com`, handle })
    // Cinto-e-suspensório (sem CHECK no DB): forçamos public numa web_imported COM imagem — o loader
    // a barra pelo `origin <> 'web_imported'`, alinhado ao eligibleForPool canônico (#168).
    const web = await seedOwnedRecipe({
      ownerId,
      titulo: 'Importada da web',
      origin: 'web_imported',
      visibility: 'public',
    })
    await seedRecipeImage({ recipeId: web, blobUrl: 'https://x/y.webp', provenance: 'user_photo' })
    // controle: uma pública normal do mesmo dono, pra a asserção não ser vácua.
    const normal = await seedOwnedRecipe({ ownerId, titulo: 'Pública normal' })

    const body = await profileBody(handle)
    const ids = recipeIds(body)
    expect(ids).toContain(normal)
    expect(ids).not.toContain(web)
  })
})

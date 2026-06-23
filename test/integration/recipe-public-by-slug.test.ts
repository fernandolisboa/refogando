import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  loadPublicRecipeBySlug,
  resolveSlugForLocale,
  resolvePublicSlugForLocale,
  resolveRecipeIdBySlug,
} from '@/server/recipe/load'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Leitura PÚBLICA por slug + resolução de slug para o redirect permanente (#230, ADR-0020) — contra
 * Postgres real (projeto "node" no CI). Cobre o que o teste ui PURO não pode: o casamento por
 * (locale, slug), o gate de leitura pública aplicado no DB (comunidade/Catálogo/playful/moderação),
 * a resolução uuid→slug PÚBLICA (leak-safe) que alimenta o permanentRedirect (308) do link legado no
 * SERVER COMPONENT, e a resolução slug→uuid (sem gate) que preserva o caminho do dono.
 */

const db = () => getDb()

describe('loadPublicRecipeBySlug — casa (locale, slug) e aplica o gate de leitura pública', () => {
  it('Receita pública: casa o slug do locale e devolve o shape montado', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de Cenoura',
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-de-cenoura',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'bolo-de-cenoura', 'pt-BR')
    expect(rows).not.toBeNull()
    expect(rows!.recipe.id).toBe(recipeId)
    expect(rows!.translations.some((t) => t.locale === 'pt-BR')).toBe(true)
  })

  it('Catálogo (ownerId NULL, visibility=private por construção) ⇒ LEGÍVEL por slug', async () => {
    // O Catálogo nasce visibility=private + ownerId NULL (createCatalogRecipe). O gate de leitura
    // pública casa o GET por uuid (eixo de comunidade owner-NULL), então o Catálogo renderiza por
    // SLUG do mesmo jeito que por uuid — sem split-brain que o 404-aria por slug enquanto rende por
    // uuid. (Regressão do must-fix de revisão: gate estrito em visibility excluía o Catálogo inteiro.)
    const recipeId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      ownerId: null,
      // visibility OMITIDA de propósito ⇒ default de banco 'private' (espelha createCatalogRecipe).
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada do Catálogo',
      provenance: 'escrita_por_pessoa',
      slug: 'feijoada-do-catalogo',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'feijoada-do-catalogo', 'pt-BR')
    expect(rows).not.toBeNull()
    expect(rows!.recipe.id).toBe(recipeId)
    expect(rows!.recipe.ownerId).toBeNull()
    expect(rows!.recipe.visibility).toBe('private') // confirma: leu private+owner-NULL como público
  })

  it('slug inexistente ⇒ null', async () => {
    const rows = await loadPublicRecipeBySlug(db(), 'nao-existe-mesmo', 'pt-BR')
    expect(rows).toBeNull()
  })

  it('slug existe em OUTRO locale ⇒ null (unicidade é por (locale, slug))', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo',
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-cross-locale',
    })

    // Mesmo slug, locale DIFERENTE ⇒ não casa.
    const rows = await loadPublicRecipeBySlug(db(), 'bolo-cross-locale', 'en-US')
    expect(rows).toBeNull()
  })

  it('Receita PRIVADA ⇒ null (não é leitura pública; o dono lê pelo caminho dinâmico)', async () => {
    const { userId } = await seedSessionHeaders({ email: 'slug-private@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Segredo',
      provenance: 'escrita_por_pessoa',
      slug: 'segredo-privado',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'segredo-privado', 'pt-BR')
    expect(rows).toBeNull()
  })

  it('Receita PLAYFUL ⇒ null (playful é sempre privada, mas o gate é explícito)', async () => {
    const { userId } = await seedSessionHeaders({ email: 'slug-playful@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private', // CHECK recipe_playful_private_chk exige private p/ playful
      resultKind: 'playful',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Goku no Bife',
      provenance: 'escrita_por_pessoa',
      slug: 'goku-no-bife',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'goku-no-bife', 'pt-BR')
    expect(rows).toBeNull()
  })

  it('Receita REMOVIDA pela moderação ⇒ null (sai da leitura pública sem tocar visibility)', async () => {
    const { userId } = await seedSessionHeaders({ email: 'slug-mod@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Removida',
      provenance: 'escrita_por_pessoa',
      slug: 'removida-do-pool',
    })
    // Remove do pool diretamente (a coluna + moderated_by saem juntas pelo CHECK).
    await db()
      .update(recipe)
      .set({ moderationRemovedAt: new Date(), moderatedBy: userId })
      .where(eq(recipe.id, recipeId))

    const rows = await loadPublicRecipeBySlug(db(), 'removida-do-pool', 'pt-BR')
    expect(rows).toBeNull()
  })
})

describe('resolveSlugForLocale — uuid + locale → slug, SEM gate (LocaleSwitcher do dono)', () => {
  it('devolve o slug do locale pedido', async () => {
    const recipeId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      provenance: 'escrita_por_pessoa',
      slug: 'feijoada',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Brazilian Stew',
      provenance: 'automatica_nao_revisada',
      slug: 'brazilian-stew',
    })

    expect(await resolveSlugForLocale(db(), recipeId, 'pt-BR')).toBe('feijoada')
    expect(await resolveSlugForLocale(db(), recipeId, 'en-US')).toBe('brazilian-stew')
  })

  it('Receita sem tradução naquele locale ⇒ null', async () => {
    const recipeId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Só PT',
      provenance: 'escrita_por_pessoa',
      slug: 'so-pt',
    })

    expect(await resolveSlugForLocale(db(), recipeId, 'en-US')).toBeNull()
  })

  it('tradução ainda SEM slug (NULL durante backfill) ⇒ null', async () => {
    const recipeId = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Sem Slug',
      provenance: 'escrita_por_pessoa',
      slug: null,
    })

    expect(await resolveSlugForLocale(db(), recipeId, 'pt-BR')).toBeNull()
  })

  it('uuid inexistente ⇒ null', async () => {
    expect(
      await resolveSlugForLocale(db(), '00000000-0000-0000-0000-000000000000', 'pt-BR'),
    ).toBeNull()
  })
})

describe('resolvePublicSlugForLocale — slug GATEADO p/ o 308 do server component (leak-safe)', () => {
  it('Receita pública ⇒ devolve o slug do locale (o server component 308-a pro canônico)', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pública',
      provenance: 'escrita_por_pessoa',
      slug: 'publica-301',
    })

    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBe('publica-301')
  })

  it('Catálogo (ownerId NULL, private) ⇒ devolve o slug (o eixo de comunidade abre o 308)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Catálogo 301',
      provenance: 'escrita_por_pessoa',
      slug: 'catalogo-301',
    })

    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBe('catalogo-301')
  })

  it('Receita PRIVADA ⇒ null (NÃO vaza o slug nem a existência num 308 anônimo)', async () => {
    // Must-fix de revisão: o redirect do UUID legado precisa ser GATEADO. Um anônimo pedindo o UUID
    // de uma Receita privada NÃO pode receber um Location revelando o slug (derivado do título). O
    // server component, ao receber null, NÃO redireciona — deixa a página tratar pelo caminho do dono
    // (404 leak-safe a quem não é dono).
    const { userId } = await seedSessionHeaders({ email: 'pubslug-private@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Segredo do Dono',
      provenance: 'escrita_por_pessoa',
      slug: 'segredo-do-dono-301',
    })

    // gateado ⇒ null (vs resolveSlugForLocale SEM gate, que devolveria o slug — provamos o contraste)
    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBeNull()
    expect(await resolveSlugForLocale(db(), recipeId, 'pt-BR')).toBe('segredo-do-dono-301')
  })

  it('Receita PLAYFUL ⇒ null (fora da leitura pública)', async () => {
    const { userId } = await seedSessionHeaders({ email: 'pubslug-playful@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'playful',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Goku no Bife',
      provenance: 'escrita_por_pessoa',
      slug: 'goku-no-bife-301',
    })

    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBeNull()
  })

  it('Receita REMOVIDA pela moderação ⇒ null', async () => {
    const { userId } = await seedSessionHeaders({ email: 'pubslug-mod@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Removida 301',
      provenance: 'escrita_por_pessoa',
      slug: 'removida-301',
    })
    await db()
      .update(recipe)
      .set({ moderationRemovedAt: new Date(), moderatedBy: userId })
      .where(eq(recipe.id, recipeId))

    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBeNull()
  })

  it('tradução ainda SEM slug (NULL no backfill), mesmo pública ⇒ null', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pública Sem Slug',
      provenance: 'escrita_por_pessoa',
      slug: null,
    })

    expect(await resolvePublicSlugForLocale(db(), recipeId, 'pt-BR')).toBeNull()
  })
})

describe('resolveRecipeIdBySlug — slug → uuid SEM gate (caminho do dono da página)', () => {
  it('casa (locale, slug) e devolve o recipeId — INCLUSIVE de Receita privada do dono', async () => {
    const { userId } = await seedSessionHeaders({ email: 'slug2id-private@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Privada Por Slug',
      provenance: 'escrita_por_pessoa',
      slug: 'privada-por-slug',
    })

    // SEM gate: o dono navega pela própria privada por slug; a rota de API reimpõe ownership.
    expect(await resolveRecipeIdBySlug(db(), 'privada-por-slug', 'pt-BR')).toBe(recipeId)
  })

  it('slug inexistente naquele locale ⇒ null (404 leak-safe no caminho do dono)', async () => {
    expect(await resolveRecipeIdBySlug(db(), 'nao-existe-por-slug', 'pt-BR')).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadPublicRecipeBySlug, resolveSlugForLocale } from '@/server/recipe/load'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Leitura PÚBLICA por slug + resolução de slug para o 301 (#230, ADR-0020) — contra Postgres
 * real (projeto "node" no CI). Cobre o que o teste ui PURO não pode: o casamento por
 * (locale, slug), o gate de leitura pública aplicado no DB (pública/playful/moderação), e a
 * resolução uuid→slug por locale que alimenta o 301 do link legado.
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

describe('resolveSlugForLocale — uuid + locale → slug (alimenta o 301 do link legado)', () => {
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

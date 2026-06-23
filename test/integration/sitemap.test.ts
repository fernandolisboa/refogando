import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { loadSitemapRecipes } from '@/server/recipe/sitemap'
import { buildSitemapEntries } from '@/domain/sitemap'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Query do sitemap (#235, ADR-0020) contra Postgres real (projeto "node"). Cobre o que o builder
 * PURO não pode: o gate de INDEXAÇÃO empurrado pro SQL — EXATAMENTE o mesmo `eligibleForPublicRead`
 * do detalhe (comunidade/Catálogo E não-`playful` E não-removida) — e os slugs POR locale que cada
 * entrada carrega. Semeia a matriz: Catálogo elegível, comunidade pública elegível, e os NÃO-
 * elegíveis (playful, privada-de-comunidade, removida), asserindo que só os elegíveis aparecem.
 */

const db = () => getDb()
const BASE = 'https://refogando.com'

describe('loadSitemapRecipes — só Receitas indexáveis, com slugs por locale', () => {
  it('Catálogo (ownerId NULL) com slug ⇒ entra (eixo de comunidade owner-NULL)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      provenance: 'escrita_por_pessoa',
      slug: 'feijoada-sm',
    })

    const rows = await loadSitemapRecipes(db())
    const mine = rows.find((r) => r.recipeId === recipeId)
    expect(mine).toBeDefined()
    expect(mine!.slugsByLocale['pt-BR']).toBe('feijoada-sm')
  })

  it('Comunidade PÚBLICA com slug ⇒ entra; traz os DOIS locales que têm slug', async () => {
    const { userId } = await seedSessionHeaders({ email: 'sm-public@ex.com' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo',
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-sm',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Cake',
      provenance: 'automatica_revisada',
      slug: 'cake-sm',
    })

    const rows = await loadSitemapRecipes(db())
    const mine = rows.find((r) => r.recipeId === recipeId)
    expect(mine).toBeDefined()
    expect(mine!.slugsByLocale).toEqual({ 'pt-BR': 'bolo-sm', 'en-US': 'cake-sm' })
  })

  it('só inclui locales com slug NÃO-NULL (en-US sem slug ⇒ fora do mapa)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pão',
      provenance: 'escrita_por_pessoa',
      slug: 'pao-sm',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Bread',
      provenance: 'automatica_nao_revisada',
      slug: null,
    })

    const rows = await loadSitemapRecipes(db())
    const mine = rows.find((r) => r.recipeId === recipeId)
    expect(mine!.slugsByLocale['pt-BR']).toBe('pao-sm')
    expect(mine!.slugsByLocale['en-US']).toBeUndefined()
  })

  it('Receita PRIVADA de comunidade ⇒ NÃO entra', async () => {
    const { userId } = await seedSessionHeaders({ email: 'sm-private@ex.com' })
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
      slug: 'segredo-sm',
    })

    const rows = await loadSitemapRecipes(db())
    expect(rows.some((r) => r.recipeId === recipeId)).toBe(false)
  })

  it('Receita PLAYFUL ⇒ NÃO entra', async () => {
    const { userId } = await seedSessionHeaders({ email: 'sm-playful@ex.com' })
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
      slug: 'goku-sm',
    })

    const rows = await loadSitemapRecipes(db())
    expect(rows.some((r) => r.recipeId === recipeId)).toBe(false)
  })

  it('Receita REMOVIDA pela moderação ⇒ NÃO entra', async () => {
    const { userId } = await seedSessionHeaders({ email: 'sm-mod@ex.com' })
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
      slug: 'removida-sm',
    })
    await db()
      .update(recipe)
      .set({ moderationRemovedAt: new Date(), moderatedBy: userId })
      .where(eq(recipe.id, recipeId))

    const rows = await loadSitemapRecipes(db())
    expect(rows.some((r) => r.recipeId === recipeId)).toBe(false)
  })

  it('Receita elegível MAS sem slug em nenhum locale ⇒ NÃO entra (sem URL canônica)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Sem Slug',
      provenance: 'escrita_por_pessoa',
      slug: null,
    })

    const rows = await loadSitemapRecipes(db())
    expect(rows.some((r) => r.recipeId === recipeId)).toBe(false)
  })

  it('end-to-end: query + builder ⇒ só as elegíveis viram entradas com URL absoluta', async () => {
    const { userId } = await seedSessionHeaders({ email: 'sm-e2e@ex.com' })
    // Elegível (Catálogo) ⇒ deve aparecer.
    const ok = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId: ok,
      locale: 'pt-BR',
      titulo: 'Visível',
      provenance: 'escrita_por_pessoa',
      slug: 'visivel-e2e',
    })
    // Não-elegível (privada) ⇒ jamais.
    const hidden = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId: hidden,
      locale: 'pt-BR',
      titulo: 'Oculta',
      provenance: 'escrita_por_pessoa',
      slug: 'oculta-e2e',
    })

    const rows = await loadSitemapRecipes(db())
    const entries = buildSitemapEntries(rows, BASE)
    const urls = entries.map((e) => e.url)
    expect(urls).toContain(`${BASE}/pt-BR/recipes/visivel-e2e`)
    expect(urls).not.toContain(`${BASE}/pt-BR/recipes/oculta-e2e`)
  })
})

describe('robots — aponta o sitemap absoluto e libera o índice', () => {
  const ORIG = process.env.APP_URL
  beforeEach(() => {
    process.env.APP_URL = BASE
  })
  afterEach(() => {
    if (ORIG === undefined) delete process.env.APP_URL
    else process.env.APP_URL = ORIG
  })

  it('sitemap = URL absoluta /sitemap.xml; allow / e disallow /api e /admin', async () => {
    const robots = (await import('@/app/robots')).default
    const out = robots()
    expect(out.sitemap).toBe(`${BASE}/sitemap.xml`)
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules]
    const all = rules[0]
    expect(all?.allow).toBe('/')
    const disallow = Array.isArray(all?.disallow) ? all!.disallow : [all?.disallow]
    expect(disallow).toContain('/api/')
    expect(disallow).toContain('/admin')
  })
})
